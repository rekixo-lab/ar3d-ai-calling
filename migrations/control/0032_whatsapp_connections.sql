-- Separate WhatsApp identities and encrypted credentials for each client.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS whatsapp_connections (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
 messaging_account_id TEXT NOT NULL,
 phone_number_id TEXT NOT NULL UNIQUE,
 display_phone TEXT NOT NULL,
 verified_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN('connected','paused')),
 credentials_ciphertext TEXT NOT NULL,
 verify_token_hash TEXT NOT NULL UNIQUE,
 templates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(templates_json)),
 webhook_verified_at TEXT,
 connected_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_polled_at TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_dispatch ON whatsapp_connections(status,last_polled_at);
