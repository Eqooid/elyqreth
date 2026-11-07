import type { CollaborationTransaction } from './collaboration.repository';

// Reuse the safe persistence view, never the ORM entity or private command/input snapshot.
export type CollaborationDetail = Awaited<ReturnType<CollaborationTransaction['getSession']>>;
export type DelegationDetail = Awaited<ReturnType<CollaborationTransaction['getDelegation']>>;
export type CollaborationParticipantsPage = Awaited<ReturnType<CollaborationTransaction['listParticipants']>>;
export type CollaborationDelegationsPage = Awaited<ReturnType<CollaborationTransaction['listDelegations']>>;
export interface CollaborationLookup { readonly collaboration: CollaborationDetail | null }
export interface DelegationLookup { readonly delegation: DelegationDetail | null }
// Pre-controller parser failures retain the existing global envelope without a code.
export interface CollaborationApiError { readonly statusCode: number; readonly code?: string; readonly message: string; readonly requestId?: string }
export type NativeActivationReceipt = Awaited<ReturnType<import('./native-coordination.service').NativeCoordinationService['activate']>>;
export type CollaborationReconciliation = Awaited<ReturnType<import('./collaboration-recovery.service').CollaborationRecoveryService['reconcile']>>;
export type CollaborationReconciliationPage = Awaited<ReturnType<import('./collaboration-recovery.service').CollaborationRecoveryService['batch']>>;
