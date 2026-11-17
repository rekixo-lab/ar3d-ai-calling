-- Apply AFTER 0001_init.sql to each shared or provisioned dedicated CRM D1.
-- Do not apply to existing AR3D Platform/Engine databases.
ALTER TABLE leads ADD COLUMN interest_status TEXT NOT NULL DEFAULT 'new'
 CHECK(interest_status IN ('new','contacted','interested','followup','not_interested','converted'));
ALTER TABLE leads ADD COLUMN followup_at TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_tenant_interest ON leads(tenant_id,interest_status,created_at);
CREATE TABLE IF NOT EXISTS lead_notes (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 2000),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lead_notes_tenant_lead ON lead_notes(tenant_id,lead_id,created_at);
