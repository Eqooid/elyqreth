import type {TaskStatus,ExecutionStatus,ClientOptions} from '../contracts';
export type {TaskStatus,ExecutionStatus};
export interface InteractionClientOptions extends ClientOptions {executeTimeoutMs?:number}
export interface RequestOptions {signal?:AbortSignal;requestId?:string}
export interface TaskReference {readonly agentId:string;readonly taskId:string}
export interface ExecutionReference extends TaskReference {readonly executionId:string}
export interface TaskInput {readonly instruction:string;readonly context?:string}
export interface SubmissionIntent {readonly agentId:string;readonly input:TaskInput;readonly idempotencyKey:string}
export interface Eligibility {readonly canCreateTask:boolean;readonly canRequestStart:boolean;readonly canRequestCancel:boolean;readonly reason:'INVALID_STATE'|'NOT_SUPPORTED'|'UNAVAILABLE'|null}
export interface Agent {readonly id:string;readonly name:string;readonly description:string|null;readonly type:'RULE_BASED'|'LLM'|'EXTERNAL';readonly orchestratorId:string;
 readonly lifecycleStatus:'ACTIVE'|'DISABLED'|'ARCHIVED';readonly capabilities:readonly string[];readonly version:number;readonly createdAt:string;readonly updatedAt:string;readonly actionEligibility:Eligibility}
export interface Task {readonly id:string;readonly agentId:string;readonly orchestratorId:string;readonly status:TaskStatus;readonly version:number;readonly createdAt:string;readonly updatedAt:string;readonly completedAt:string|null}
export interface TaskDetail extends Task {readonly actionEligibility:Eligibility}
export interface TaskRuntimeStatus extends TaskDetail {readonly latestExecutionId:string|null}
export interface Execution {readonly id:string;readonly taskId:string;readonly agentId:string;readonly orchestratorId:string;readonly attemptNumber:number;readonly status:ExecutionStatus;readonly version:number;
 readonly createdAt:string;readonly updatedAt:string;readonly startedAt:string|null;readonly finishedAt:string|null;readonly durationMs:number|null;
 readonly errorCode:'EXECUTION_ERROR'|'EXECUTION_TIMED_OUT'|null;readonly errorMessage:string|null;readonly resultAvailability:'NONE'|'PENDING'|'AVAILABLE'|'UNAVAILABLE';readonly strategyId:string|null;readonly correlationId:string|null}
export interface ExecutionDetail extends Execution {readonly actionEligibility:Eligibility}
export interface RuntimeResult {readonly schemaVersion:1;readonly executionId:string;
 readonly output:Readonly<{type:'text.statistics.v1';data:Readonly<{codePointCount:number;wordCount:number;nonemptyLineCount:number}>}>|Readonly<{type:'text';text:string}>;
 readonly usage?:Readonly<{inputTokens:number|null;outputTokens:number|null;totalTokens:number|null}>;readonly toolSummary?:Readonly<{invocationCount:number}>}
export interface StartResponse {readonly kind:'finished';readonly task:Task;readonly execution:Execution;readonly correlationId:string;readonly result:RuntimeResult|null;readonly displayReason?:'DISCLOSURE_RESTRICTED'}
export interface CancellationVersions {readonly taskVersion:number;readonly executionVersion:number}
export interface CancellationResponse {readonly task:Task;readonly execution:Execution|null}
export interface ResultResponse {readonly execution:Execution;readonly availability:'PENDING'|'AVAILABLE'|'UNAVAILABLE';readonly result:RuntimeResult|null;readonly displayReason?:'DISCLOSURE_RESTRICTED'}
export interface HistoryQuery {readonly limit?:number;readonly before?:string}
export interface HistoryResponse {readonly items:readonly Execution[];readonly pagination:Readonly<{limit:number;nextCursor:string|null}>}
export interface RecoveryResponse {readonly task:Task|null}
export type Operation='getAgent'|'createTask'|'getTask'|'getTaskStatus'|'executeTask'|'getExecution'|'cancelExecution'|'getResult'|'listAgentExecutions'|'findTaskByIntent';
export type InteractionErrorCode=import('../contracts').ErrorCode|'CONFLICT'|'RUNTIME_FAILURE';
export interface ValidationIssue {readonly field:'request'|'agentId'|'input.instruction'|'input.context'|'idempotencyKey'|'version'|'query'|'options';readonly code:'INVALID_VALUE'|'TOO_LARGE'|'UNSUPPORTED_FIELD'}
export interface ErrorContext {operation?:Operation;status?:number;backendCode?:string;requestId?:string;retryAfterMs?:number;outcome?:'NOT_SENT'|'UNKNOWN'|'NOT_APPLICABLE';
 source?:'configuration'|'validation'|'http'|'network'|'timeout'|'abort'|'schema'|'authentication';issues?:readonly ValidationIssue[]}
