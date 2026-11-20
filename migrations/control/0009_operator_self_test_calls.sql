-- AR3D AI Calling CONTROL D1 ONLY. Operator-initiated verified self-test.
-- No customer phone, transcript, recording, lead or tenant data is stored.
-- Existing CRM call/consent/agent deny triggers MUST remain unchanged.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS exotel_operator_test_calls (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  actor_user_id TEXT NOT NULL REFERENCES human_users(id),
  rate_slot TEXT NOT NULL UNIQUE CHECK(length(rate_slot) BETWEEN 10 AND 24),
  provider_call_sid TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('reserved','submitted','unknown','rejected')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exotel_operator_test_calls_actor
  ON exotel_operator_test_calls(actor_user_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_operator_test_immutable
BEFORE UPDATE OF id,actor_user_id,rate_slot,created_at
ON exotel_operator_test_calls
BEGIN SELECT RAISE(ABORT,'operator test identity immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_operator_test_terminal
BEFORE UPDATE OF state ON exotel_operator_test_calls
WHEN OLD.state!='reserved'
BEGIN SELECT RAISE(ABORT,'operator test cannot be retried or reclassified'); END;
CREATE TRIGGER IF NOT EXISTS trg_operator_test_no_delete
BEFORE DELETE ON exotel_operator_test_calls
BEGIN SELECT RAISE(ABORT,'operator test audit may not be deleted'); END;
