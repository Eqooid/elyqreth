import { Injectable, Optional } from '@nestjs/common';
import { requestContext,requestSecrets } from './request-context';
import { ApiConfig } from '../config/config.module';
import { logEvents,logFields } from './log-policy';

@Injectable()
export class ApiLogger {
  constructor(@Optional() private readonly config?:ApiConfig){}
  private write(level:'info'|'error',event:string,fields:unknown):void{
    try{
      const c=this.config?.value,secrets:string[]=[...requestSecrets()];
      for(const value of [c?.database?.password,c?.registry?.token,c?.cityRead?.token,c?.interaction?.token,c?.collaborationRead?.token])if(value)secrets.push(value);
      for(const profile of c?.llm?.profiles??[]){const value=c?.llm?.credentials.get(profile.id);if(value)secrets.push(value);}
      for(const connection of c?.externalOrchestrators?.connections??[]){const value=c?.externalOrchestrators?.credentials.resolve(connection.credentialRef);if(value)secrets.push(value);}
      // Fixed public event names cannot be suppressed by a caller choosing a matching Cookie value.
      const name=(logEvents as readonly string[]).includes(event)?event:'telemetry.rejected';
      const data=logFields(name,fields,secrets),context=logFields(name,requestContext.getStore(),secrets);
      const line=JSON.stringify({...data,...context,timestamp:new Date().toISOString(),level,service:'elyqreth-api',
        environment:c?.nodeEnv??'unknown',component:name.split(/[._]/,1)[0],event:name})+'\n';
      (level==='error'?process.stderr:process.stdout).write(line);
    }catch{/* Telemetry must not change authorization, HTTP responses or committed lifecycle outcomes. */}
  }
  info(event: string, fields: Record<string, unknown> = {}): void {
    this.write('info',event,fields);
  }

  error(event: string, fields: Record<string, unknown> = {}): void {
    this.write('error',event,fields);
  }
}
