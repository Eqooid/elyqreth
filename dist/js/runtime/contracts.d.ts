export type ActivityStatus='IDLE'|'QUEUED'|'RUNNING'|'UNKNOWN';
export type TaskStatus='CREATED'|'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED';
export type ExecutionStatus='PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'TIMED_OUT';
export type StatusReason='NO_ACTIVE_WORK'|'AWAITING_QUEUE'|'PERSISTED_QUEUED'|'CURRENT_LEASE'|'INCONSISTENT_STATE'|'DEADLINE_EXPIRED'|'LEASE_UNVERIFIED'|'EXTERNAL_LIVENESS_UNVERIFIED';
export interface AgentActivity {
 readonly externalObservation?: Readonly<{source:'Hermes';connectionId:string;connectionName:string;externalAgentId:string;externalExecutionId:string|null;
 mappingId:string|null;version:number;status:'UNKNOWN'|'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED';sourceStatus:string|null;
 observedAt:string|null;lastSynchronizedAt:string|null;freshness:'UNKNOWN'|'RECENT_OBSERVATION'|'STALE'|'RETIRED';connectionHealth:'UNKNOWN'|'DISABLED'}>;
 readonly schemaVersion:1;readonly agentId:string;readonly name:string;readonly agentType:'RULE_BASED'|'LLM'|'EXTERNAL';
 readonly availability:'ACTIVE'|'DISABLED'|'ARCHIVED';readonly agentVersion:number;
 readonly npcId:string|null;readonly bindingId:string|null;readonly activityStatus:ActivityStatus;
 readonly currentTask:Readonly<{id:string;status:TaskStatus;version:number}>|null;
 readonly currentExecution:Readonly<{id:string;status:ExecutionStatus;version:number;attemptNumber:number}>|null;
 readonly activeExecutionCount:number;readonly queuedTaskCount:number;readonly createdTaskCount:number;
 readonly recentOutcome:Readonly<{taskId:string;executionId:string|null;status:'COMPLETED'|'FAILED'|'CANCELLED'|'UNKNOWN';executionStatus:ExecutionStatus|null;finishedAt:string}>|null;
 readonly lastExecution:Readonly<{id:string;taskId:string;status:ExecutionStatus}>|null;
 readonly lastActivityAt:string;readonly observedAt:string;readonly requiresAttention:boolean;readonly statusReason:StatusReason;
}
export interface ActivityPage {readonly schemaVersion:1;readonly observedAt:string;readonly items:readonly AgentActivity[];readonly nextCursor:string|null}
export interface ActivityQuery {readonly limit?:number;readonly after?:string;readonly ids?:readonly string[]}
export type ErrorCode='STALE_SNAPSHOT'|'CONFIGURATION'|'AUTH_REQUIRED'|'FORBIDDEN'|'NOT_FOUND'|'VALIDATION'|'SCHEMA'|'NETWORK'|'SERVER'|'TIMEOUT'|'CANCELLED'|'RATE_LIMITED'|'LIMIT_EXCEEDED';
export interface SafeError {readonly code:ErrorCode;readonly message:string}
export interface Timers {setTimeout(callback:()=>void,delay:number):number;clearTimeout(handle:number):void}
export interface Clock {now():number;wallNow():number}
export interface ClientOptions {access?:'account';baseUrl:string;pageOrigin?:string;fetchImpl?:typeof fetch;timeoutMs?:number;timers?:Timers;clock?:Clock}
export interface RuntimeSnapshot {
 readonly phase:'DISCONNECTED'|'LOADING'|'READY'|'REFRESHING'|'ERROR'|'AUTH_REQUIRED'|'PAUSED';
 readonly activitiesByAgentId:Readonly<Record<string,AgentActivity>>;readonly missingAgentIds:readonly string[];
 readonly loading:boolean;readonly refreshing:boolean;readonly error:SafeError|null;
 readonly freshness:'unknown'|'fresh'|'stale';readonly stale:boolean;
 readonly lastObservedAt:string|null;readonly lastSuccessfulSyncAt:string|null;
}
export interface SyncOptions {
 intervalMs?:number;timeoutMs?:number;staleMs?:number;unknownMs?:number;maxPages?:number;maxAgents?:number;pageSize?:number;
 timers?:Timers;clock?:Clock;random?:()=>number;fetchImpl?:typeof fetch;
 visibility?:{isHidden():boolean;listen(callback:()=>void):()=>void};
 online?:{listen(callback:()=>void):()=>void};
}
export interface ConnectOptions {access?:'account';fetchImpl?:typeof fetch;baseUrl:string;pageOrigin?:string;token:string;agentIds?:readonly string[]}
export interface RuntimeView {
 getSnapshot():RuntimeSnapshot;
 getAgent(agentId:string):AgentActivity|undefined;
 getByNpc(npcId:string):AgentActivity|undefined;
 subscribe(listener:(snapshot:RuntimeSnapshot)=>void):()=>void;
}
