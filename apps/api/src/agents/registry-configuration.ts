export interface RegistryConfiguration {
  readonly ownerId: string;
  readonly token: string;
}

export const isLoopback = (host: string): boolean =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(host);

export function registryEnvironment(
  env: Readonly<Record<string, string | undefined>>, nodeEnv: string, host: string,
  hasDatabase: boolean, errors: string[], authenticated=false,
): RegistryConfiguration | undefined {
  const enabled = env.AGENT_REGISTRY_ENABLED;
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') errors.push('AGENT_REGISTRY_ENABLED');
  if (enabled !== 'true') return undefined;
  if (!hasDatabase || !authenticated && (!['development', 'test'].includes(nodeEnv) || !isLoopback(host))) errors.push('AGENT_REGISTRY_ENABLED');
  const ownerId = env.AGENT_REGISTRY_OWNER_ID ?? '';
  const token = env.AGENT_REGISTRY_TOKEN ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) errors.push('AGENT_REGISTRY_OWNER_ID');
  if (!authenticated && !/^[A-Za-z0-9_-]{32,128}$/.test(token)) errors.push('AGENT_REGISTRY_TOKEN');
  return Object.freeze({ ownerId, token });
}
