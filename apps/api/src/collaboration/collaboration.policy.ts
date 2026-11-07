import { CollaborationError } from './collaboration.domain';

export function nativeSession(authority: string): void {
  if (authority !== 'NATIVE') throw new CollaborationError('NOT_FOUND');
}
export function openSession(status: string): void {
  if (!['CREATED', 'ACTIVE', 'WAITING'].includes(status)) throw new CollaborationError('INELIGIBLE_COLLABORATION');
}
export function eligibleAgent(agent: { type: string; lifecycleStatus: string }, enabledRoute: boolean): void {
  if (!['RULE_BASED', 'LLM'].includes(agent.type) || agent.lifecycleStatus !== 'ACTIVE' || !enabledRoute)
    throw new CollaborationError('INELIGIBLE_AGENT');
}
export function activeMembers(members: readonly { agentId: string; leftAt: Date | null; role: string }[], source: string, target: string): void {
  if (source === target) throw new CollaborationError('INVALID_RELATION');
  if (![source, target].every(id => members.some(m => m.agentId === id && m.leftAt === null && ['COORDINATOR', 'DELEGATE'].includes(m.role))))
    throw new CollaborationError('ACCESS_DENIED');
}
export function successfulSource(task: { id: string; agentId: string; status: string; orchestratorId: string },
  attempt: { id: string; taskId: string; agentId: string; status: string; authority: string } | undefined,
  source: { id: string; orchestratorId: string }, executionId: string): void {
  if (task.agentId !== source.id) throw new CollaborationError('INVALID_RELATION');
  if (task.status !== 'COMPLETED' || task.orchestratorId !== source.orchestratorId || !attempt ||
    attempt.id !== executionId || attempt.taskId !== task.id || attempt.agentId !== source.id ||
    attempt.status !== 'SUCCEEDED' || attempt.authority !== 'NATIVE') throw new CollaborationError('INELIGIBLE_TASK');
}
export interface NativeRelation { parentTaskId: string; childTaskId: string | null; continuationTaskId: string | null; status: string }
/** Fixed first recipe: no fanout, at most three work Tasks/depth two, including reserved child slots. */
export function parentContext(root: string | null, rows: readonly NativeRelation[], parent: string): void {
  if (!root) throw new CollaborationError('INELIGIBLE_COLLABORATION');
  const depths = new Map<string, number>([[root, 0]]), tasks = new Set<string>([root]);
  for (let pass = 0; pass < 3; pass++) for (const r of rows) {
    if (r.childTaskId && depths.has(r.parentTaskId)) depths.set(r.childTaskId, depths.get(r.parentTaskId)! + 1);
    if (r.continuationTaskId && r.childTaskId && depths.has(r.childTaskId)) depths.set(r.continuationTaskId, depths.get(r.childTaskId)! + 1);
    for (const id of [r.parentTaskId, r.childTaskId, r.continuationTaskId]) if (id) tasks.add(id);
  }
  if (!depths.has(parent)) throw new CollaborationError('INVALID_RELATION');
  if (rows.some(r => r.parentTaskId === parent)) throw new CollaborationError('CONFLICT');
  const reserved = rows.filter(r => !r.childTaskId && ['REQUESTED', 'ACCEPTED', 'EXECUTING', 'AWAITING_RETURN'].includes(r.status)).length;
  if (rows.length >= 2 || depths.get(parent)! >= 2 || tasks.size + reserved + 1 > 3) throw new CollaborationError('LIMIT_EXCEEDED');
}
