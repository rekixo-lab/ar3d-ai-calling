-- AR3D AI Calling CONTROL D1 ONLY. Authenticated Exotel Voicebot webhook receipts.
-- Metadata-only quarantine: no customer phone, transcript, account ID, lead ID or raw JSON.
-- This is not a call-to-lead registry; no CRM changes or live calls are enabled.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS exotel_voicebot_event_receipts (
  receipt_key TEXT PRIMARY KEY NOT NULL CHECK(length(receipt_key)=64),
  account_fingerprint TEXT NOT NULL CHECK(length(account_fingerprint)=64),
  session_fingerprint TEXT NOT NULL CHECK(length(session_fingerprint)=64),
  call_fingerprint TEXT NOT NULL CHECK(length(call_fingerprint)=64),
  conversation_fingerprint TEXT NOT NULL CHECK(length(conversation_fingerprint)=64),
  event_fingerprint TEXT NOT NULL CHECK(length(event_fingerprint)=64),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('transcript','session_end')),
  turn_status TEXT NOT NULL CHECK(turn_status IN ('completed','inprogress','none')),
  possible_opt_out INTEGER NOT NULL DEFAULT 0 CHECK(possible_opt_out IN (0,1)),
  status TEXT NOT NULL DEFAULT 'quarantined' CHECK(status='quarantined'),
  received_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>0)
);
CREATE INDEX IF NOT EXISTS idx_exotel_receipts_expiry
  ON exotel_voicebot_event_receipts(expires_at);
CREATE TRIGGER IF NOT EXISTS trg_exotel_voicebot_receipt_immutable
BEFORE UPDATE ON exotel_voicebot_event_receipts
BEGIN SELECT RAISE(ABORT,'Exotel webhook receipt is immutable'); END;
