import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, ValidationPipe, UnsupportedMediaTypeException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Request, Response, NextFunction } from 'express';
import { ApiConfiguration } from '../config/configuration';
import { ApiLogger } from './api-logger';
import { requestContext,bindRequestSecrets } from './request-context';
import { interactionPrincipal } from '../interaction/interaction.context';

export type ApiRequest = Request & { requestId?: string };

const messages: Record<number, string> = {
  400: 'Request is invalid.', 401: 'Authentication required.', 403: 'Access denied.',
  404: 'Route not found.', 405: 'Method not allowed.', 409: 'Request conflicts with current state.',
  413: 'Request body is too large.', 415: 'Unsupported media type.',
  422: 'Request cannot be processed.', 429: 'Too many requests.',
  503: 'Service unavailable.',
};

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: ApiLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<Response>();
    const parserError = exception as { type?: unknown; status?: unknown; code?:unknown } | null;
    const invalidCompression=parserError?.status===400&&['Z_DATA_ERROR','Z_BUF_ERROR','ERR_PADDING_1','ERR_PADDING_2'].includes(String(parserError.code));
    const parserStatus = ['entity.too.large','parameters.too.many'].includes(String(parserError?.type)) ? 413 :
      ['encoding.unsupported','charset.unsupported'].includes(String(parserError?.type)) ? 415 :
      parserError?.type === 'entity.parse.failed'||invalidCompression ? 400 : 500;
    const status = exception instanceof HttpException ? exception.getStatus() : parserStatus;
    if (status >= 500&&req.path!=='/ready') this.logger.error('request_failed', { requestId: req.requestId, statusCode: status });
    if (res.headersSent) { res.end(); return; }
    res.status(status).json({
      statusCode: status,
      ...(interactionPrincipal()?{code:({400:'INVALID_INPUT',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',413:'PAYLOAD_TOO_LARGE',415:'UNSUPPORTED_MEDIA',429:'RATE_LIMITED',503:'UNAVAILABLE'} as Record<number,string>)[status]??'INTERNAL_ERROR'}:{}),
      message: messages[status] ?? (status >= 500 ? 'Internal server error.' : 'Request failed.'),
      requestId: req.requestId,
    });
  }
}

export function configureHttp(
  app: NestExpressApplication, config: ApiConfiguration, logger: ApiLogger,
): void {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  let lastHealthLog=0;
  app.use((req: ApiRequest, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(incoming)
      ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const started = performance.now();
    const context=Object.freeze({requestId:req.requestId});bindRequestSecrets(context,req.headers.authorization,req.headers.cookie);
    res.once('close', () => requestContext.run(context,() => {
      if(req.path==='/ready')return;
      if(req.path==='/health'&&res.statusCode===200){if(Date.now()-lastHealthLog<60000)return;lastHealthLog=Date.now();}
      // Matched route template only; never log URL/query, body or request headers.
      const route: unknown = req.route?.path;
      logger.info('http_request', {
        requestId: req.requestId, method: req.method,
        route: typeof route === 'string' ? route : 'unmatched',
        statusCode: res.writableFinished ? res.statusCode : 499,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    }));
    requestContext.run(context, next);
  });
  app.enableCors({
    origin: (origin, callback) => callback(null, origin !== undefined && config.corsOrigins.includes(origin)),
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'If-Match'],
    exposedHeaders: ['X-Request-Id'], credentials: false, maxAge: 600,
  });
  // The production browser/API contract sends plain JSON. Reject unused compressed-body
  // decoders before parsing/authentication, rather than exposing optional inflation paths.
  app.use((req:Request,_res:Response,next:NextFunction)=>{
    const encoding=req.headers['content-encoding'];
    if(config.nodeEnv==='production'&&encoding!==undefined&&String(encoding).trim().toLowerCase()!=='identity'){
      next(new UnsupportedMediaTypeException());return;
    }next();
  });
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { limit: '64kb', extended: false, parameterLimit: 100 });
  app.useGlobalPipes(new ValidationPipe({
    transform: true, whitelist: true, forbidNonWhitelisted: true,
    forbidUnknownValues: true, transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false }, disableErrorMessages: true,
  }));
  app.useGlobalFilters(new SafeExceptionFilter(logger));
  // The actual process entry point installs one coordinated signal owner.
}
