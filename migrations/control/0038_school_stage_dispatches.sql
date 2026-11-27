-- Phase 3E staging runtime only; NOT in the production deployment workflow.
CREATE TABLE IF NOT EXISTS school_stage_dispatches (
 permit_id TEXT PRIMARY KEY REFERENCES school_internal_pilot_permits(id),
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 provider_account TEXT NOT NULL,
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
 approved_by TEXT NOT NULL REFERENCES human_users(id),
 funding_ref TEXT NOT NULL,
 plivo_reserved_usd_micros INTEGER NOT NULL CHECK(plivo_reserved_usd_micros>0),
 sarvam_reserved_inr_micros INTEGER NOT NULL CHECK(sarvam_reserved_inr_micros>0),
 max_seconds INTEGER NOT NULL CHECK(max_seconds BETWEEN 1 AND 60),
 claimed_at INTEGER NOT NULL,
 dispatch_state TEXT NOT NULL DEFAULT 'claimed' CHECK(dispatch_state IN('claimed','submitted','unknown','rejected')),
 phase TEXT NOT NULL DEFAULT 'waiting' CHECK(phase IN('waiting','consent','question','processing','finished','ended')),
 turn INTEGER NOT NULL DEFAULT 0 CHECK(turn BETWEEN 0 AND 3),
 recordings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(recordings_json) AND json_type(recordings_json)='array' AND json_array_length(recordings_json)<=3 AND length(recordings_json)<=256)
);
CREATE TRIGGER IF NOT EXISTS trg_school_stage_dispatch_immutable BEFORE UPDATE ON school_stage_dispatches
WHEN NEW.permit_id<>OLD.permit_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.provider_account<>OLD.provider_account
 OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.approved_by<>OLD.approved_by OR NEW.funding_ref<>OLD.funding_ref
 OR NEW.plivo_reserved_usd_micros<>OLD.plivo_reserved_usd_micros OR NEW.sarvam_reserved_inr_micros<>OLD.sarvam_reserved_inr_micros
 OR NEW.max_seconds<>OLD.max_seconds OR NEW.claimed_at<>OLD.claimed_at
 OR (OLD.dispatch_state<>'claimed' AND NEW.dispatch_state<>OLD.dispatch_state)
 OR NEW.turn<OLD.turn OR NEW.turn>OLD.turn+1 OR (OLD.phase='ended' AND NEW.phase<>'ended')
BEGIN SELECT RAISE(ABORT,'immutable school stage dispatch scope'); END;
CREATE TRIGGER IF NOT EXISTS trg_school_stage_dispatch_no_delete BEFORE DELETE ON school_stage_dispatches
BEGIN SELECT RAISE(ABORT,'school stage reservation cannot be deleted'); END;
