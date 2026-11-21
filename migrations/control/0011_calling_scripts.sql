PRAGMA foreign_keys=ON;
CREATE TABLE calling_script_bindings (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
 bot_id TEXT NOT NULL UNIQUE, assistant_id TEXT NOT NULL UNIQUE,
 source_version TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE calling_script_versions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), config_json TEXT NOT NULL,
 prompt TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 provider_state TEXT NOT NULL DEFAULT 'draft' CHECK(provider_state IN('draft','sending','saved','failed','unknown')),
 provider_version TEXT, provider_bot_id TEXT, provider_assistant_id TEXT,
 error_code TEXT, synced_at TEXT, synced_by TEXT,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,revision)
);
CREATE UNIQUE INDEX calling_script_one_send ON calling_script_versions(tenant_id)
 WHERE provider_state IN('sending','unknown');
CREATE TRIGGER calling_script_immutable BEFORE UPDATE OF tenant_id,id,revision,config_json,prompt,created_by,created_at
 ON calling_script_versions BEGIN SELECT RAISE(ABORT,'script versions are immutable'); END;
