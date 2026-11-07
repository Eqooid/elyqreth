-- Preserve raw provider status separately from trusted adapter normalization. No native schema changes.
CREATE OR REPLACE FUNCTION elyqreth_external_mapping_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE src external_sources%ROWTYPE; member external_agent_mappings%ROWTYPE; a agents%ROWTYPE; ev external_event_inbox%ROWTYPE; c collaboration_sessions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text || ':external-ingestion',0));
 IF TG_TABLE_NAME='external_sources' THEN
  IF NOT EXISTS(SELECT 1 FROM orchestrators o WHERE o.id=NEW.connection_id AND o.owner_id=NEW.owner_id AND o.type=NEW.adapter_type AND o.type<>'native' AND o.registration_status='ENABLED') THEN RAISE EXCEPTION 'Invalid external source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO src FROM external_sources WHERE id=NEW.source_id AND owner_id=NEW.owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid external scope' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='external_agent_mappings' THEN
  IF TG_OP='UPDATE' AND (OLD.status='TOMBSTONED' OR NEW.status<>'TOMBSTONED') THEN RAISE EXCEPTION 'Immutable external membership' USING ERRCODE='23514'; END IF;
  IF NEW.internal_agent_id IS NOT NULL THEN
   SELECT * INTO a FROM agents WHERE id=NEW.internal_agent_id AND owner_id=NEW.owner_id;
   IF NOT FOUND OR a.type<>'EXTERNAL' OR a.orchestrator_id<>src.connection_id THEN RAISE EXCEPTION 'Invalid external Agent mapping' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO member FROM external_agent_mappings WHERE id=NEW.agent_mapping_id AND source_id=NEW.source_id AND owner_id=NEW.owner_id;
 IF NOT FOUND OR member.status<>'ACTIVE' THEN RAISE EXCEPTION 'Inactive external identity' USING ERRCODE='23514'; END IF;
 IF member.internal_agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agents WHERE id=member.internal_agent_id AND owner_id=NEW.owner_id AND type='EXTERNAL' AND orchestrator_id=src.connection_id AND lifecycle_status<>'ARCHIVED') THEN RAISE EXCEPTION 'Invalid external identity' USING ERRCODE='23514'; END IF;
 IF NEW.collaboration_id IS NOT NULL THEN
  SELECT * INTO c FROM collaboration_sessions WHERE id=NEW.collaboration_id AND owner_id=NEW.owner_id;
  IF NOT FOUND OR c.authority<>'EXTERNAL' OR member.internal_agent_id IS NULL OR NOT EXISTS(SELECT 1 FROM collaboration_participants WHERE owner_id=NEW.owner_id AND session_id=NEW.collaboration_id AND agent_id=member.internal_agent_id AND left_at IS NULL) THEN RAISE EXCEPTION 'Invalid external collaboration' USING ERRCODE='23514'; END IF;
  IF NEW.delegation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM collaboration_delegations WHERE id=NEW.delegation_id AND session_id=NEW.collaboration_id AND owner_id=NEW.owner_id AND target_agent_id=member.internal_agent_id) THEN RAISE EXCEPTION 'Invalid external delegation' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'UNKNOWN' OR NEW.last_event_id IS NOT NULL OR NEW.sequence IS NOT NULL OR NEW.source_status IS NOT NULL THEN RAISE EXCEPTION 'Observation requires inbox evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status IN ('COMPLETED','FAILED','CANCELLED') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'Terminal external outcome is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.sequence IS NOT NULL AND (NEW.sequence_domain IS DISTINCT FROM OLD.sequence_domain OR NEW.sequence IS NULL OR NEW.sequence::numeric<=OLD.sequence::numeric) THEN RAISE EXCEPTION 'Stale external observation' USING ERRCODE='23514'; END IF;
  SELECT * INTO ev FROM external_event_inbox WHERE source_id=NEW.source_id AND owner_id=NEW.owner_id AND event_id=NEW.last_event_id;
  IF NOT FOUND OR ev.status IN ('APPLIED','STALE','OBSERVED') OR ev.event->>'kind' IS DISTINCT FROM 'execution.observed' OR ev.event->>'externalExecutionId' IS DISTINCT FROM NEW.external_id OR ev.event->>'externalAgentId' IS DISTINCT FROM member.external_id OR src.ordering_domain IS NULL OR NEW.sequence_domain IS DISTINCT FROM src.ordering_domain OR NEW.sequence_domain IS DISTINCT FROM ev.event#>>'{sequence,domain}' OR NEW.sequence IS DISTINCT FROM ev.event#>>'{sequence,value}' OR NEW.source_status IS DISTINCT FROM ev.event->>'sourceStatus' OR NEW.status IS DISTINCT FROM COALESCE(ev.event->>'normalizedStatus', (CASE WHEN ev.event->>'sourceStatus' IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED') THEN ev.event->>'sourceStatus' ELSE 'UNKNOWN' END)) THEN RAISE EXCEPTION 'Invalid external observation evidence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
