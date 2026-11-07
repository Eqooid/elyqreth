import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CollaborationApiService } from './collaboration-api.service';
import { CollaborationHttpGuard } from './collaboration-http.guard';
import { CollaborationApiFilter } from './collaboration-api.filter';
import { ActivateDelegationDto, CollaborationLookupDto, CollaborationPageDto, CreateCollaborationDto, RequestDelegationDto } from './collaboration.dto';
import { NativeCoordinationService } from './native-coordination.service';
import { RuntimeError } from '../runtime/contracts/runtime-error.contract';
import { ApiRequest } from '../common/http-foundation';
import { CollaborationRecoveryService } from './collaboration-recovery.service';
import { terminalSession } from './collaboration-aggregation';

@Controller('api/v1/collaborations') @UseGuards(CollaborationHttpGuard) @UseFilters(CollaborationApiFilter)
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationApiService, private readonly coordination: NativeCoordinationService,
    private readonly recovery: CollaborationRecoveryService) {}
  @Post('reconcile') @HttpCode(200) batch(@Body() dto: CollaborationPageDto) { return this.recovery.batch(dto); }
  @Post(':sessionId/reconcile') @HttpCode(200) reconcile(@Param('sessionId', new ParseUUIDPipe()) id: string) { return this.recovery.reconcile(id); }
  @Post(':sessionId/cancel')
  async cancelSession(@Param('sessionId', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) res: Response) {
    const outcome = await this.recovery.cancel(id); res.status(terminalSession(outcome.collaboration.status) ? 200 : 202); return outcome;
  }
  @Post(':sessionId/delegations/:delegationId/cancel')
  async cancelDelegation(@Param('sessionId', new ParseUUIDPipe()) sessionId: string, @Param('delegationId', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response) {
    const outcome = await this.recovery.cancel(sessionId, id); res.status(terminalSession(outcome.collaboration.status) ? 200 : 202); return outcome;
  }
  @Post(':sessionId/delegations/:delegationId/recover')
  async recover(@Param('sessionId', new ParseUUIDPipe()) sessionId: string, @Param('delegationId', new ParseUUIDPipe()) id: string,
    @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const controller = new AbortController(), abort = () => { if (!res.writableFinished) controller.abort(new RuntimeError('CANCELLED')); };
    req.once('aborted', abort); res.once('close', abort);
    const timer = setTimeout(() => controller.abort(new RuntimeError('DEADLINE_EXCEEDED')), 30000);
    if (req.aborted || res.destroyed) abort();
    try {
      const outcome = await this.recovery.recover(sessionId, id, controller.signal);
      res.status(terminalSession(outcome.collaboration.status) ? 200 : 202); return outcome;
    } finally { clearTimeout(timer); req.removeListener('aborted', abort); res.removeListener('close', abort); }
  }
  @Post()
  async create(@Body() dto: CreateCollaborationDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.collaboration.create(dto); res.status(result.created ? 201 : 200); return result.value;
  }
  @Get('lookup') lookup(@Query() q: CollaborationLookupDto) { return this.collaboration.lookupSession(q.idempotencyKey); }
  @Get(':sessionId') detail(@Param('sessionId', new ParseUUIDPipe()) id: string) { return this.collaboration.detail(id); }
  @Get(':sessionId/participants') participants(@Param('sessionId', new ParseUUIDPipe()) id: string, @Query() q: CollaborationPageDto) {
    return this.collaboration.participants(id, q);
  }
  @Post(':sessionId/delegations')
  async request(@Param('sessionId', new ParseUUIDPipe()) id: string, @Body() dto: RequestDelegationDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.collaboration.request(id, dto); res.status(result.created ? 201 : 200); return result.value;
  }
  @Get(':sessionId/delegations/lookup') lookupDelegation(@Param('sessionId', new ParseUUIDPipe()) id: string, @Query() q: CollaborationLookupDto) {
    return this.collaboration.lookupDelegation(id, q.idempotencyKey);
  }
  @Get(':sessionId/delegations/:delegationId') delegation(@Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Param('delegationId', new ParseUUIDPipe()) id: string) { return this.coordination.observe(sessionId, id).then(value => value.delegation); }
  @Post(':sessionId/delegations/:delegationId/activate')
  async activate(@Param('sessionId', new ParseUUIDPipe()) sessionId: string, @Param('delegationId', new ParseUUIDPipe()) id: string,
    @Body() dto: ActivateDelegationDto, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const controller = new AbortController(), abort = () => { if (!res.writableFinished) controller.abort(new RuntimeError('CANCELLED')); };
    req.once('aborted', abort); res.once('close', abort);
    const timer = setTimeout(() => controller.abort(new RuntimeError('DEADLINE_EXCEEDED')), 30000);
    if (req.aborted || res.destroyed) abort();
    try {
      const receipt = await this.coordination.activate(sessionId, id, dto, controller.signal);
      res.status(receipt.dispatchState === 'SETTLED' ? 200 : 202); return receipt;
    } finally { clearTimeout(timer); req.removeListener('aborted', abort); res.removeListener('close', abort); }
  }
  @Get(':sessionId/delegations') history(@Param('sessionId', new ParseUUIDPipe()) id: string, @Query() q: CollaborationPageDto) {
    return this.collaboration.history(id, q);
  }
}
