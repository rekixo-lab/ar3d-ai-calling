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
-- Request-level progress lets multi-client webhook retries skip completed groups.
-- This table contains hashes and provider number IDs only, never customer messages.
CREATE TABLE IF NOT EXISTS whatsapp_webhook_batches (
 batch_hash TEXT PRIMARY KEY CHECK(length(batch_hash)=64),
 signature_hash TEXT NOT NULL CHECK(length(signature_hash)=64),
 next_group INTEGER NOT NULL DEFAULT 0 CHECK(next_group>=0),
 group_count INTEGER NOT NULL CHECK(group_count>=0),
 pending_phone_ids_json TEXT NOT NULL CHECK(json_valid(pending_phone_ids_json) AND json_type(pending_phone_ids_json)='array'),
 received_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 processed_at TEXT,
 CHECK(next_group<=group_count)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_batches_pending ON whatsapp_webhook_batches(processed_at,next_group);
