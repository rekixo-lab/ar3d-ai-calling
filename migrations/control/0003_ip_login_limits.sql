-- Apply ONLY to the independent AR3D AI Calling Control D1, after 0002.
-- IP is NEVER persisted; the key is an HMAC digest using a Worker-only secret.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS human_ip_login_limits (
  ip_hash TEXT PRIMARY KEY CHECK(length(ip_hash)=64),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  window_start INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_human_ip_login_blocked ON human_ip_login_limits(blocked_until);
