export const RUNTIME_CONTEXT_FACTORY = Symbol('ELYQRETH_RUNTIME_CONTEXT_FACTORY');
// Explicit compiled registrations: text.stats.v1; no automatic invocation.
export const RUNTIME_STRATEGIES = Symbol('ELYQRETH_RUNTIME_STRATEGIES');
// T06 explicitly registers Ollama; no eager connection or executable tools.
export const LLM_PROVIDERS = Symbol('ELYQRETH_LLM_PROVIDERS');
export const AUTHORIZED_TOOL_INVOKER = Symbol('ELYQRETH_AUTHORIZED_TOOL_INVOKER');
export const TOOL_HANDLERS = Symbol('ELYQRETH_COMPILED_TOOL_HANDLERS');
export const TOOL_CLOCK = Symbol('ELYQRETH_TOOL_SYSTEM_CLOCK');
export const TOOL_EXECUTION_AUTHORITY = Symbol('ELYQRETH_TOOL_EXECUTION_AUTHORITY');
