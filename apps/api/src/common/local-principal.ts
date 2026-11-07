/** Existing local credential audiences, not human accounts or production identities.
 * Values are issued only after the shared transport/credential verifier succeeds.
 * Agent IDs, external IDs, request headers and resource IDs never prove a principal. */
export interface LocalPrincipal {
  readonly kind: 'LOCAL_CREDENTIAL';
  readonly audience: 'operator' | 'city-read' | 'interaction' | 'collaboration-read';
  readonly ownerId: string;
  readonly actorReference: string;
}
