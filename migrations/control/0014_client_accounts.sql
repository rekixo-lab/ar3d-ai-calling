-- Calling Control D1 only. Never run on Platform or Engine databases.
-- Stores builder account contact details; credentials remain invitation-driven.
PRAGMA foreign_keys=ON;
CREATE TABLE client_account_contacts (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  mobile_e164 TEXT NOT NULL CHECK(mobile_e164 GLOB '+91[6-9][0-9]*' AND length(mobile_e164)=13),
  created_by TEXT NOT NULL REFERENCES human_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_client_account_contacts_email ON client_account_contacts(email);
