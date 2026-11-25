CREATE TABLE IF NOT EXISTS team_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES human_users(id),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  secret_iv TEXT,
  secret_ciphertext TEXT
);
CREATE INDEX IF NOT EXISTS team_invitations_email ON team_invitations(email);
CREATE TABLE IF NOT EXISTS team_acceptances (
  invite_id TEXT NOT NULL PRIMARY KEY REFERENCES team_invitations(id),
  user_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
