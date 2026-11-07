import { isUUID } from 'class-validator';
import { createRuntimeDefinition, RuntimeDefinition } from './contracts/definition.contract';
import { freeze, record } from './contracts/validation';

export interface RuntimeBinding { readonly agentId: string; readonly orchestratorId: string; readonly definition: RuntimeDefinition }
export interface RuntimeConfiguration {
  readonly drainTimeoutMs:number;
  readonly bindings: readonly RuntimeBinding[];
  readonly tools?: {readonly allowedCapabilities:readonly string[]};
}
export function runtimeEnvironment(env: Readonly<Record<string, string | undefined>>, nodeEnv: string,
  hasRegistry: boolean, errors: string[],authenticated=false): RuntimeConfiguration | undefined {
  if (env.RUNTIME_ENABLED !== undefined && !['true','false'].includes(env.RUNTIME_ENABLED)) errors.push('RUNTIME_ENABLED');
  if (env.RUNTIME_ENABLED !== 'true') {
    if(env.RUNTIME_DRAIN_TIMEOUT_MS!==undefined)errors.push('RUNTIME_DRAIN_TIMEOUT_MS');
    if (env.RUNTIME_BINDINGS !== undefined) errors.push('RUNTIME_BINDINGS');
    if(env.RUNTIME_TOOLS_ENABLED!==undefined&&env.RUNTIME_TOOLS_ENABLED!=='false'||env.RUNTIME_TOOL_ALLOWLIST!==undefined)errors.push('RUNTIME_TOOLS_ENABLED');
    return undefined;
  }
  if (!hasRegistry || !authenticated&&!['development','test'].includes(nodeEnv)) errors.push('RUNTIME_ENABLED');
  const drainText=env.RUNTIME_DRAIN_TIMEOUT_MS??'15000',drainTimeoutMs=Number(drainText);
  if(!/^\d+$/.test(drainText)||!Number.isInteger(drainTimeoutMs)||drainTimeoutMs<100||drainTimeoutMs>20000)errors.push('RUNTIME_DRAIN_TIMEOUT_MS');
  try {
    if(env.RUNTIME_TOOLS_ENABLED!==undefined&&!['true','false'].includes(env.RUNTIME_TOOLS_ENABLED))throw new Error();
    let tools:RuntimeConfiguration['tools'];
    if(env.RUNTIME_TOOLS_ENABLED==='true'){
      const policyText=env.RUNTIME_TOOL_ALLOWLIST??'';
      if(Buffer.byteLength(policyText,'utf8')>256)throw new Error();
      const allowed:unknown=JSON.parse(policyText);
      if(!Array.isArray(allowed)||!allowed.length||allowed.length>2||new Set(allowed).size!==allowed.length||
        allowed.some(cap=>!['tool.calculator.v1','tool.current_datetime.v1'].includes(cap)))throw new Error();
      tools=freeze({allowedCapabilities:freeze([...allowed].sort() as string[])});
    }else if(env.RUNTIME_TOOL_ALLOWLIST!==undefined)throw new Error();
    const text = env.RUNTIME_BINDINGS ?? '';
    if (Buffer.byteLength(text, 'utf8') > 32768) throw new Error();
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data) || data.length > 64) throw new Error();
    const seen = new Set<string>();
    const bindings = data.map(value => {
      const b = record(value, ['agentId','orchestratorId','definition'], 'definition');
      if (typeof b.agentId !== 'string' || !isUUID(b.agentId) || typeof b.orchestratorId !== 'string' || !isUUID(b.orchestratorId)) throw new Error();
      const agentId = b.agentId.toLowerCase();
      if (seen.has(agentId)) throw new Error(); seen.add(agentId);
      const definition = createRuntimeDefinition(b.definition);
      if ((definition.budget.maxToolCalls || definition.toolCapabilities.length)&&
        (!tools||definition.toolCapabilities.some(cap=>!tools!.allowedCapabilities.includes(cap))))throw new Error();
      return freeze({ agentId, orchestratorId: b.orchestratorId.toLowerCase(), definition });
    });
    return freeze({ bindings: freeze(bindings),drainTimeoutMs,...(tools?{tools}:{}) });
  } catch { errors.push('RUNTIME_BINDINGS'); return undefined; }
}
