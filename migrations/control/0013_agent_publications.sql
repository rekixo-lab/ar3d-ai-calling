CREATE TABLE shared_voice_gateway (
 id INTEGER PRIMARY KEY CHECK(id=1),
 bot_id TEXT NOT NULL,
 flow_id TEXT NOT NULL,
 template_assistant_id TEXT NOT NULL,
 template_version TEXT NOT NULL,
 guard_assistant_id TEXT,
 gateway_version TEXT,
 state TEXT NOT NULL CHECK(state IN('configuring','staged','ready','unknown')),
 error_code TEXT,
 updated_by TEXT NOT NULL REFERENCES human_users(id),
 updated_at TEXT NOT NULL,
 last_verified_at TEXT
);
CREATE TABLE calling_agent_publications (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 id TEXT NOT NULL,
 script_revision INTEGER NOT NULL,
 profile_revision INTEGER NOT NULL,
 prompt TEXT NOT NULL,
 greeting TEXT NOT NULL,
 provider_bot_id TEXT NOT NULL,
 provider_assistant_id TEXT,
 provider_state TEXT NOT NULL CHECK(provider_state IN('sending','ready','failed','unknown')),
 provider_version TEXT,
 error_code TEXT,
 created_by TEXT NOT NULL REFERENCES human_users(id),
 created_at TEXT NOT NULL,
 published_at TEXT,
 PRIMARY KEY(tenant_id,id)
);
CREATE UNIQUE INDEX calling_agent_assistant_unique ON calling_agent_publications(provider_assistant_id) WHERE provider_assistant_id IS NOT NULL;
CREATE UNIQUE INDEX calling_agent_one_inflight ON calling_agent_publications(tenant_id) WHERE provider_state IN('sending','unknown');
CREATE TRIGGER calling_agent_publication_content_immutable BEFORE UPDATE ON calling_agent_publications
WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.script_revision<>OLD.script_revision OR NEW.profile_revision<>OLD.profile_revision OR NEW.prompt<>OLD.prompt OR NEW.greeting<>OLD.greeting OR NEW.provider_bot_id<>OLD.provider_bot_id OR (OLD.provider_assistant_id IS NOT NULL AND NEW.provider_assistant_id IS NOT OLD.provider_assistant_id) OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'publication content is immutable'); END;
CREATE TRIGGER calling_agent_publication_no_delete BEFORE DELETE ON calling_agent_publications
BEGIN SELECT RAISE(ABORT,'publication history is immutable'); END;
CREATE TABLE voice_call_routes (
 call_key TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 publication_id TEXT NOT NULL,
 job_id TEXT,
 operator_request_id TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 CHECK((job_id IS NOT NULL AND operator_request_id IS NULL) OR (job_id IS NULL AND operator_request_id IS NOT NULL)),
 FOREIGN KEY(tenant_id,publication_id) REFERENCES calling_agent_publications(tenant_id,id)
);
CREATE TRIGGER voice_call_routes_no_update BEFORE UPDATE ON voice_call_routes
BEGIN SELECT RAISE(ABORT,'voice call routing evidence is immutable'); END;
CREATE TRIGGER voice_call_routes_no_delete BEFORE DELETE ON voice_call_routes
BEGIN SELECT RAISE(ABORT,'voice call routing evidence is immutable'); END;
