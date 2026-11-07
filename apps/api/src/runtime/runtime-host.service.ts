import { Injectable, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { ApiConfig } from '../config/config.module';
import { ApiLogger } from '../common/api-logger';
import { RuntimeError } from './contracts/runtime-error.contract';

export type RuntimeHostState='STARTING'|'READY'|'DRAINING'|'STOPPING'|'STOPPED';
export const RUNTIME_FINALIZATION_MS=5000;
/** Process admission only. PostgreSQL remains the Execution/lease authority. */
@Injectable()
export class RuntimeHostService implements OnApplicationBootstrap,OnModuleDestroy,OnApplicationShutdown {
  private state:RuntimeHostState='STARTING';
  private readonly operations=new Map<symbol,{kind:'execute'|'queue';abort:()=>void}>();
  private readonly listeners=new Set<()=>void>();
  private draining:Promise<void>|undefined;private stopping:Promise<void>|undefined;
  private drainStartedAt:string|null=null;private deadline:number|null=null;private timedOut=false;
  private serving=false;
  constructor(private readonly config:ApiConfig,private readonly logger:ApiLogger){}
  onApplicationBootstrap(){if(this.state==='STARTING')this.state='READY';}
  markServing(){this.serving=true;}
  assertAdmitting():void {if(this.state!=='READY')throw new RuntimeError('RUNTIME_DRAINING','request');}
  acquire(kind:'execute'|'queue',abort:()=>void):()=>void {
    this.assertAdmitting();const token=Symbol(kind);this.operations.set(token,{kind,abort});
    let released=false;return()=>{if(released)return;released=true;this.operations.delete(token);for(const listener of [...this.listeners])listener();};
  }
  get admitting(){return this.state==='READY';}
  snapshot(){return Object.freeze({state:this.state,admitting:this.admitting,activeExecutions:[...this.operations.values()].filter(o=>o.kind==='execute').length,
    pendingQueueOperations:[...this.operations.values()].filter(o=>o.kind==='queue').length,drainStartedAt:this.drainStartedAt,
    remainingDrainMs:this.state!=='DRAINING'||this.deadline===null?null:Math.max(0,Math.ceil(this.deadline-performance.now())),drainTimedOut:this.timedOut});}
  private log(event:string){if(!this.serving)return;try{this.logger.info(event,{...this.snapshot()});}catch{/* Telemetry never decides lifecycle. */}}
  private wait(ms:number):Promise<boolean>{
    if(!this.operations.size)return Promise.resolve(true);
    return new Promise(resolve=>{let timer:NodeJS.Timeout;const finish=(idle:boolean)=>{clearTimeout(timer);this.listeners.delete(check);resolve(idle);};
      const check=()=>{if(!this.operations.size)finish(true);};this.listeners.add(check);timer=setTimeout(()=>finish(false),ms);check();});
  }
  beginDrain():Promise<void>{
    if(this.draining)return this.draining;
    if(this.state==='STOPPING'||this.state==='STOPPED')return Promise.resolve();
    this.state='DRAINING';this.drainStartedAt=new Date().toISOString();
    const ms=this.config.value.runtime?.drainTimeoutMs??15000;this.deadline=performance.now()+ms;this.log('runtime.drain.started');
    this.draining=this.wait(ms).then(idle=>{this.timedOut=!idle;this.log(idle?'runtime.drain.completed':'runtime.drain.deadline');});
    return this.draining;
  }
  stop():Promise<void>{
    if(this.stopping)return this.stopping;
    const drain=this.beginDrain();
    this.stopping=(async()=>{await drain;this.state='STOPPING';this.log('runtime.stopping');
      for(const operation of this.operations.values()){try{operation.abort();}catch{}}
      await this.wait(RUNTIME_FINALIZATION_MS);this.state='STOPPED';this.log('runtime.stopped');})();
    return this.stopping;
  }
  onModuleDestroy(){return this.stop();}
  onApplicationShutdown(){this.state='STOPPED';}
}
