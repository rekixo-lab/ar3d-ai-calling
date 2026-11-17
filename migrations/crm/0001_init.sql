-- Apply independently to SHARED CRM D1 and every provisioned dedicated CRM D1.
-- Composite tenant foreign keys enforce ownership at the database layer.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS leads (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  mobile_e164 TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('excel','website','ads','referral','existing','other')),
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK(consent_status IN ('unknown','granted','denied')),
  consent_proof TEXT,
  consent_at TEXT,
  dnd_status TEXT NOT NULL DEFAULT 'unknown' CHECK(dnd_status IN ('unknown','allowed','blocked')),
  preferred_location TEXT,
  budget_min_inr INTEGER,
  budget_max_inr INTEGER,
  requirements_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,mobile_e164),
  CHECK(consent_status <> 'granted' OR (consent_proof IS NOT NULL AND consent_at IS NOT NULL)),
  CHECK(budget_min_inr IS NULL OR budget_min_inr >= 0),
  CHECK(budget_max_inr IS NULL OR budget_max_inr >= 0)
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS agents (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  language_mode TEXT NOT NULL DEFAULT 'hi-en' CHECK(language_mode IN ('hi','en','hi-en')),
  questions_json TEXT NOT NULL DEFAULT '[]',
  knowledge_scope_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS calls (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider_call_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','initiating','ringing','connected','completed','failed','blocked')),
  recording_object_key TEXT,
  transcript_object_key TEXT,
  outcome_json TEXT,
  call_started_at TEXT,
  call_ended_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id),
  FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_created ON calls(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS site_visits (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  project_link_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','confirmed','completed','cancelled')),
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS crm_audit_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
