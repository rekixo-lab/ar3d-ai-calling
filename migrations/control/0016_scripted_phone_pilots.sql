-- Isolated verified-phone pilot. No campaign dispatch or customer schedules.
CREATE TABLE scripted_phone_pilots (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 lead_id TEXT NOT NULL,
 lead_updated_at TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES human_users(id),
 language TEXT NOT NULL CHECK(language IN ('hi','en')),
 destination TEXT NOT NULL,
 caller TEXT NOT NULL,
 rate_slot INTEGER NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('requested','consent','question','transcribing','finishing',
   'completed','declined','needs_review','ended','unknown','rejected')),
 provider_call_id TEXT UNIQUE,
 provider_request_id TEXT UNIQUE,
 turn INTEGER NOT NULL DEFAULT 0,
 survey_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
