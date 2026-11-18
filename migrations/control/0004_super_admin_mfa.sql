-- Apply ONLY to ar3d-calling-control after 0003, not AR3D Platform or Engine.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS human_mfa_settings (
  user_id TEXT PRIMARY KEY REFERENCES human_users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL CHECK(length(secret_ciphertext)=72),
  secret_iv TEXT NOT NULL CHECK(length(secret_iv)=24),
  enabled_at TEXT,
  pending_expires_at INTEGER,
  last_used_step INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS human_mfa_challenges (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES human_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON human_mfa_challenges(user_id,expires_at);
