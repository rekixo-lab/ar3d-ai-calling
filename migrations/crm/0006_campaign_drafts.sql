-- AR3D AI Calling CRM only, after 0005. No call execution is possible.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS call_campaign_drafts(
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  language_mode TEXT NOT NULL CHECK(language_mode IN ('hi','en','hi-en')),
  purpose TEXT NOT NULL CHECK(purpose IN ('property_information','site_visit')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_drafts_tenant ON call_campaign_drafts(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS call_campaign_candidates(
  tenant_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,campaign_id,lead_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES call_campaign_drafts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campaign_candidates_lead ON call_campaign_candidates(tenant_id,lead_id);
CREATE TRIGGER IF NOT EXISTS trg_no_call_launch
BEFORE INSERT ON calls
BEGIN SELECT RAISE(ABORT,'real call creation disabled pending reviewed provider integration'); END;
