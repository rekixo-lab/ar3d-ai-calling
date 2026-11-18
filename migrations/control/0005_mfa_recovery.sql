-- AR3D AI Calling Control D1 only, after 0004. Never run on Platform/Engine D1.
PRAGMA foreign_keys=ON;
ALTER TABLE human_mfa_settings ADD COLUMN recovery_generation_id TEXT;
CREATE TABLE IF NOT EXISTS human_mfa_recovery_codes (
  user_id TEXT NOT NULL REFERENCES human_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL CHECK(length(code_hash)=64),
  created_at TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY(user_id,code_hash)
);
CREATE INDEX IF NOT EXISTS idx_human_recovery_unused ON human_mfa_recovery_codes(user_id,used_at);
