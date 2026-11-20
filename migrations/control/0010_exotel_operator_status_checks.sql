-- AR3D AI Calling CONTROL D1 ONLY.
-- Immutable read-only Exotel Call Details observations for existing operator self-tests.
-- No customer/lead/tenant phone, transcript, recording, provider payload or billing data.
-- The CRM call launch and agent deny triggers remain untouched.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS exotel_operator_status_checks (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  call_request_id TEXT NOT NULL REFERENCES exotel_operator_test_calls(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
  check_slot TEXT NOT NULL CHECK(length(check_slot) BETWEEN 5 AND 24),
  state TEXT NOT NULL CHECK(state IN ('reserved','verified','unknown')),
  provider_status TEXT CHECK(provider_status IN ('queued','in-progress','completed','failed','busy','no-answer')),
  duration_seconds INTEGER CHECK(duration_seconds BETWEEN 0 AND 14400),
  error_code TEXT CHECK(error_code IN ('provider_unavailable','provider_mismatch','audit_unconfirmed')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(call_request_id,check_slot),
  CHECK (
    (state='reserved' AND provider_status IS NULL AND duration_seconds IS NULL AND error_code IS NULL AND finished_at IS NULL)
    OR (state='verified' AND provider_status IS NOT NULL AND error_code IS NULL AND finished_at IS NOT NULL)
    OR (state='unknown' AND provider_status IS NULL AND duration_seconds IS NULL AND error_code IS NOT NULL AND finished_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_exotel_operator_status_checks_request
  ON exotel_operator_status_checks(call_request_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_exotel_status_check_identity_immutable
BEFORE UPDATE OF id,call_request_id,actor_user_id,check_slot,created_at
ON exotel_operator_status_checks
BEGIN SELECT RAISE(ABORT,'operator status evidence identity immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_exotel_status_check_one_finalization
BEFORE UPDATE ON exotel_operator_status_checks
WHEN OLD.state!='reserved' OR NEW.state NOT IN ('verified','unknown')
BEGIN SELECT RAISE(ABORT,'operator status evidence final and immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_exotel_status_check_no_delete
BEFORE DELETE ON exotel_operator_status_checks
BEGIN SELECT RAISE(ABORT,'operator status evidence may not be deleted'); END;
