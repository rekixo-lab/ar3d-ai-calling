-- Phase 3D: isolated offline-reviewed internal pilot authorizations and evidence.
-- Not applied to production by this PR. No dialing or public route is registered.
CREATE TABLE IF NOT EXISTS school_internal_pilot_permits (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
 graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 target_sha256 TEXT NOT NULL CHECK(length(target_sha256)=64 AND target_sha256 NOT GLOB '*[^0-9a-f]*'),
 approved_by TEXT NOT NULL REFERENCES human_users(id),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 8 AND 160),
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 max_audio_chars INTEGER NOT NULL CHECK(max_audio_chars BETWEEN 1 AND 4000),
 max_call_seconds INTEGER NOT NULL CHECK(max_call_seconds BETWEEN 1 AND 60),
 audio_state TEXT NOT NULL DEFAULT 'pending' CHECK(audio_state IN ('pending','claimed','ready','failed')),
 manifest_json TEXT, manifest_sha256 TEXT,
 stopped_at INTEGER, stopped_by TEXT REFERENCES human_users(id),
 CHECK(expires_at>created_at AND expires_at<=created_at+3600000),
 CHECK((stopped_at IS NULL)=(stopped_by IS NULL)),
 CHECK((audio_state='ready' AND manifest_json IS NOT NULL AND json_valid(manifest_json) AND length(manifest_sha256)=64)
 OR (audio_state<>'ready' AND manifest_json IS NULL AND manifest_sha256 IS NULL)),
 FOREIGN KEY(tenant_id,snapshot_id) REFERENCES ai_flow_snapshots(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS school_internal_provider_evidence (
 permit_id TEXT PRIMARY KEY REFERENCES school_internal_pilot_permits(id),
 request_uuid TEXT NOT NULL UNIQUE,
 call_uuid TEXT UNIQUE,
 answer_nonce_hash TEXT UNIQUE,
 hangup_nonce_hash TEXT UNIQUE,
 ended INTEGER NOT NULL DEFAULT 0 CHECK(ended IN(0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 2),
 CHECK(ended=0 OR hangup_nonce_hash IS NOT NULL),
 CHECK(call_uuid IS NOT NULL OR (answer_nonce_hash IS NULL AND hangup_nonce_hash IS NULL))
);
CREATE TRIGGER IF NOT EXISTS trg_school_internal_permit_guard BEFORE UPDATE ON school_internal_pilot_permits
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.snapshot_id<>OLD.snapshot_id
 OR NEW.graph_sha256<>OLD.graph_sha256 OR NEW.target_sha256<>OLD.target_sha256
 OR NEW.approved_by<>OLD.approved_by OR NEW.evidence_ref<>OLD.evidence_ref
 OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
 OR NEW.max_audio_chars<>OLD.max_audio_chars OR NEW.max_call_seconds<>OLD.max_call_seconds
 OR (OLD.stopped_at IS NOT NULL AND (NEW.stopped_at IS NOT OLD.stopped_at OR NEW.stopped_by IS NOT OLD.stopped_by))
 OR (NEW.audio_state<>OLD.audio_state AND NOT ((OLD.audio_state='pending' AND NEW.audio_state='claimed')
 OR (OLD.audio_state='claimed' AND NEW.audio_state IN ('ready','failed'))))
 OR (OLD.audio_state='ready' AND (NEW.manifest_json IS NOT OLD.manifest_json OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256))
BEGIN SELECT RAISE(ABORT,'school pilot permit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_school_internal_provider_guard BEFORE UPDATE ON school_internal_provider_evidence
WHEN NEW.permit_id<>OLD.permit_id OR NEW.request_uuid<>OLD.request_uuid
 OR NEW.revision<>OLD.revision+1
 OR (OLD.call_uuid IS NOT NULL AND NEW.call_uuid IS NOT OLD.call_uuid)
 OR (OLD.answer_nonce_hash IS NOT NULL AND NEW.answer_nonce_hash IS NOT OLD.answer_nonce_hash)
 OR (OLD.hangup_nonce_hash IS NOT NULL AND NEW.hangup_nonce_hash IS NOT OLD.hangup_nonce_hash)
 OR OLD.ended=1
BEGIN SELECT RAISE(ABORT,'school pilot provider evidence is immutable'); END;
