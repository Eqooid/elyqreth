-- Persistence invariants only: no task scheduling, transition service or publisher.
CREATE FUNCTION elyqreth_touch_record() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  IF to_jsonb(NEW) ? 'version' THEN NEW.version := OLD.version + 1; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION elyqreth_immutable_columns() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> column_name) IS DISTINCT FROM (to_jsonb(OLD) -> column_name) THEN
      RAISE EXCEPTION 'Immutable identity or snapshot column' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION elyqreth_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Historical records are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION elyqreth_terminal_record() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' AND OLD.status IN ('COMPLETED','FAILED','CANCELLED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'Terminal task history is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'executions' AND OLD.status IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR
       NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.finished_at IS DISTINCT FROM OLD.finished_at OR
       NEW.error_code IS DISTINCT FROM OLD.error_code OR NEW.error_message IS DISTINCT FROM OLD.error_message THEN
      RAISE EXCEPTION 'Terminal attempt history is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orchestrators_identity BEFORE UPDATE ON orchestrators FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','created_at');
CREATE TRIGGER orchestrators_metadata BEFORE UPDATE ON orchestrators FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER agents_identity BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','created_at');
CREATE TRIGGER agents_metadata BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER tasks_identity BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','created_at','agent_id','orchestrator_id','input','idempotency_key','request_hash');
CREATE TRIGGER tasks_metadata BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER tasks_terminal BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION elyqreth_terminal_record();
CREATE TRIGGER tasks_history BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER executions_identity BEFORE UPDATE ON executions FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','created_at','task_id','agent_id','orchestrator_id','attempt_number','submission_key','authority','agent_config_snapshot','adapter_key','config_version');
CREATE TRIGGER executions_metadata BEFORE UPDATE ON executions FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER executions_terminal BEFORE UPDATE ON executions FOR EACH ROW EXECUTE FUNCTION elyqreth_terminal_record();
CREATE TRIGGER executions_history BEFORE DELETE ON executions FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER bindings_identity BEFORE UPDATE ON city_agent_bindings FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','created_at');
CREATE TRIGGER bindings_metadata BEFORE UPDATE ON city_agent_bindings FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER results_history BEFORE UPDATE OR DELETE ON execution_results FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER audit_history BEFORE UPDATE OR DELETE ON command_audit FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION elyqreth_assign_event_position() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO owner_streams(owner_id) VALUES (NEW.owner_id) ON CONFLICT DO NOTHING;
  -- This row lock is held to COMMIT. A later owner cursor cannot overtake an
  -- uncommitted earlier event, and a rollback rolls back the increment too.
  UPDATE owner_streams SET last_position = last_position + 1
    WHERE owner_id = NEW.owner_id RETURNING last_position INTO NEW.stream_position;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION elyqreth_enqueue_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO event_outbox(owner_id, event_id) VALUES (NEW.owner_id, NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_position BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION elyqreth_assign_event_position();
CREATE TRIGGER events_outbox AFTER INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION elyqreth_enqueue_event();
CREATE TRIGGER events_history BEFORE UPDATE OR DELETE ON agent_events FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
