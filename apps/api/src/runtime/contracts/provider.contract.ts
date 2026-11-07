// Provider-neutral ports only: no SDK, transport implementation or credentials.
export interface ProviderCapabilities {
  readonly text: true;
  readonly transportAbort: true;
  readonly remoteCancellation: 'unknown' | 'best_effort';
  readonly structuredOutput: 'none' | 'json' | 'schema';
  readonly toolCalls: boolean;
  readonly streaming: false;
  readonly tokenUsage?: 'none' | 'optional';
}
export interface ResolvedProviderProfile {
  readonly id: string;
  readonly profileVersion: number;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  readonly bindingDigest?: string; // Nonsecret adapter/endpoint pin; required by T05 selection.
}
export interface TokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}
export type LlmUsageMetadata = TokenUsage;
export type LlmProviderCapabilities = ProviderCapabilities;
export type LlmMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string; readonly calls?:readonly LlmToolCall[] }
  | { readonly role: 'tool'; readonly callId: string; readonly toolId:string; readonly content: string };
export interface LlmToolCall {readonly callId:string;readonly toolId:string;readonly arguments:unknown}
// Opaque, adapter-owned and Execution-bound. Never stored in results/events.
export interface ProviderContinuation {readonly opaque?:never}
export interface AuthorizedToolDescription {
  readonly toolId: string;
  readonly version: number;
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly description:string;
  readonly inputSchema:Readonly<Record<string,unknown>>;
}
export interface LlmGenerateRequest {
  readonly messages: readonly LlmMessage[];
  readonly maxOutputTokens: number;
  readonly output: { readonly kind: 'text' };
  readonly tools?: readonly AuthorizedToolDescription[];
  readonly continuation?:ProviderContinuation;
}
export interface LlmRequestContext {
  readonly executionId: string;
  readonly correlationId: string;
  readonly profile: ResolvedProviderProfile;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}
export type LlmGenerateResult =
  | { readonly kind: 'text'; readonly text: string; readonly usage?: TokenUsage }
  | { readonly kind: 'tool_proposals'; readonly calls: readonly LlmToolCall[];
      readonly continuation?:ProviderContinuation;readonly usage?: TokenUsage };
export interface LlmProvider {
  readonly id: string;
  capabilities(profile: ResolvedProviderProfile): ProviderCapabilities;
  generate(request: LlmGenerateRequest, context: LlmRequestContext): Promise<LlmGenerateResult>;
}
