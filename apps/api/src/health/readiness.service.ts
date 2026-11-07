import { Injectable, Optional, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown } from '@nestjs/common';
import { RuntimeHostService } from '../runtime/runtime-host.service';
import { DatabaseService } from '../database/database.module';
import { DatabaseConnectionError } from '../database/pool';
import { DatabaseAccessError } from '../database/access-policy';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import { performance } from 'node:perf_hooks';

@Injectable()
export class ReadinessService implements OnApplicationBootstrap,OnModuleDestroy,OnApplicationShutdown{
 private started=false;private serving=false;private draining=false;private flight:Promise<boolean>|undefined;private checkedAt=Number.NEGATIVE_INFINITY;private last=false;
 private dependency='UNKNOWN';private observedAt:string|null=null;
 constructor(private readonly database:DatabaseService,private readonly config:ApiConfig,private readonly logger:ApiLogger,@Optional() private readonly host?:RuntimeHostService){}
 async onApplicationBootstrap(){
  if(this.config.value.nodeEnv==='production'&&!await this.probe())throw new DatabaseConnectionError();
  this.started=true;
 }
 markServing(){this.serving=true;this.host?.markServing();this.logDependency();}
 drain(){if(this.draining)return;this.draining=true;void this.host?.beginDrain();if(this.serving)this.logger.info('api_draining',{service:'elyqreth-api'});}
 get isDraining(){return this.draining;}
 snapshot(){return {started:this.started,draining:this.draining,dependency:this.dependency,observedAt:this.observedAt,
  database:typeof this.database.diagnostics==='function'?this.database.diagnostics():{configured:!!this.config.value.database}};}
 private logDependency(){if(this.serving)try{this.logger.info('readiness.changed',{dependency:this.dependency});}catch{}}
 private observe(dependency:string){const changed=this.dependency!==dependency;this.dependency=dependency;this.observedAt=new Date().toISOString();if(changed)this.logDependency();}
 private reason(error:unknown){const code=(error as {code?:string}|null)?.code;return error instanceof DatabaseAccessError?'DATABASE_ACCESS':code==='42501'?'DATABASE_PERMISSION':
  code==='53300'?'DATABASE_CAPACITY':code==='57014'?'DATABASE_TIMEOUT':'DATABASE_UNAVAILABLE';}
 async ready(){if(!this.started||this.draining||this.host&&!this.host.admitting)return false;const result=await this.probe();return result&&!this.draining&&(!this.host||this.host.admitting);}
 private async probe():Promise<boolean>{
  if(performance.now()-this.checkedAt<1000)return this.last;
  if(!this.flight){this.flight=this.database.checkReadiness().then(result=>{this.observe(result?(this.config.value.database?'READY':'NOT_CONFIGURED'):'SCHEMA_INCOMPATIBLE');return result;},error=>{this.observe(this.reason(error));return false;})
   .then(result=>{this.last=result;this.checkedAt=performance.now();return result;}).finally(()=>{this.flight=undefined;});}
  let timer:NodeJS.Timeout|undefined;
  try{return await Promise.race([this.flight,new Promise<false>(resolve=>{timer=setTimeout(()=>{this.observe('CHECK_TIMEOUT');resolve(false);},1500);})]);}
  finally{clearTimeout(timer);}
 }
 onModuleDestroy(){this.drain();}
 onApplicationShutdown(){}
}
