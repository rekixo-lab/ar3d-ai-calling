-- Human identity is separate from machine API keys and tenant project IDs.
-- Apply ONLY to ar3d-calling-control D1, never to Platform / Engine D1.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS human_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK(password_iterations>=200000),
  global_role TEXT NOT NULL DEFAULT 'user' CHECK(global_role IN ('user','super_admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES human_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('client_admin','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_membership_user ON tenant_memberships(user_id,status);
CREATE TABLE IF NOT EXISTS human_sessions (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES human_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_user ON human_sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS human_invitations (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('client_admin','viewer')),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES human_users(id),
  created_at TEXT NOT NULL,
  redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitation_tenant ON human_invitations(tenant_id,expires_at);
CREATE TABLE IF NOT EXISTS human_login_limits (
  email_hash TEXT PRIMARY KEY CHECK(length(email_hash)=64),
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

-- One-time transactional claim to prevent two concurrent Super Admin bootstraps.
CREATE TABLE IF NOT EXISTS human_bootstrap_claim (
  id INTEGER PRIMARY KEY CHECK(id=1), created_at TEXT NOT NULL
);
