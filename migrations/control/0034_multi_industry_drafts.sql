-- AR3D AI Calling Control D1 ONLY. Additive, no provider or CRM changes.
-- Phase 1 stores client-authored *drafts*; no table supports active/publication states.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tenant_industry_profiles (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 industry_code TEXT NOT NULL CHECK(industry_code IN('real_estate','school','services','finance','banking','insurance')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 updated_by TEXT NOT NULL REFERENCES human_users(id),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_flow_definitions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 template_id TEXT NOT NULL CHECK(template_id IN('property_enquiry_v1','school_admission_v1','appointment_reminder_v1','finance_due_notice_v1','banking_service_v1','insurance_renewal_v1')),
 industry_code TEXT NOT NULL CHECK(industry_code IN('real_estate','school','services','finance','banking','insurance')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json)='object' AND length(config_json) BETWEEN 2 AND 8000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_by TEXT NOT NULL REFERENCES human_users(id),
 created_at TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES human_users(id),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ai_flow_definitions_tenant ON ai_flow_definitions(tenant_id,updated_at DESC,id);
