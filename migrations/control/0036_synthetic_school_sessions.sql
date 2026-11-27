-- Phase 3C: synthetic-only School pilot state; not a live call table.
-- Deliberately not wired into the production deployment workflow.
CREATE TABLE IF NOT EXISTS synthetic_school_sessions (
 tenant_id TEXT NOT NULL CHECK(tenant_id GLOB 'synthetic-*' AND length(tenant_id)<=90),
 session_id TEXT NOT NULL CHECK(session_id GLOB 'synthetic-*' AND length(session_id)<=90),
 graph_json TEXT NOT NULL CHECK(json_valid(graph_json) AND length(graph_json)<=32768),
 expires_at INTEGER NOT NULL CHECK(expires_at>0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 12),
 state_json TEXT NOT NULL CHECK(json_valid(state_json) AND json_type(state_json)='object' AND length(state_json)<=10000),
 events_json TEXT NOT NULL CHECK(json_valid(events_json) AND json_type(events_json)='array' AND json_array_length(events_json)=revision AND length(events_json)<=4000),
 PRIMARY KEY(tenant_id,session_id),
 CHECK(json_extract(state_json,'$.tenantId') IS tenant_id AND json_extract(state_json,'$.sessionId') IS session_id
 AND json_extract(state_json,'$.expiresAt') IS expires_at AND json_extract(state_json,'$.sequence') IS revision)
);
CREATE INDEX IF NOT EXISTS idx_synthetic_school_expiry ON synthetic_school_sessions(expires_at);
CREATE TRIGGER IF NOT EXISTS trg_synthetic_school_session_transition
 BEFORE UPDATE ON synthetic_school_sessions
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.session_id<>OLD.session_id OR NEW.graph_json<>OLD.graph_json
 OR NEW.expires_at<>OLD.expires_at OR NEW.revision<>OLD.revision+1
 OR json_extract(NEW.state_json,'$.snapshotId') IS NOT json_extract(OLD.state_json,'$.snapshotId')
 OR json_extract(NEW.state_json,'$.graphSha256') IS NOT json_extract(OLD.state_json,'$.graphSha256')
 OR json_extract(NEW.state_json,'$.startedAt') IS NOT json_extract(OLD.state_json,'$.startedAt')
 BEGIN SELECT RAISE(ABORT,'invalid synthetic school transition'); END;
