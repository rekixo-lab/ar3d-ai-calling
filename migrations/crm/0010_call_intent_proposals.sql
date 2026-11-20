-- Calling CRM v10, isolated Calling D1 only. This is a BLOCKED,
-- immutable proposal, NOT a registered/approved dispatch intent.
-- Never stores mobile number, provider CallSid, vendor payload or transcript.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS call_intent_proposals (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(length(id)=36),
  campaign_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('property_information','site_visit')),
  state TEXT NOT NULL DEFAULT 'blocked' CHECK(state='blocked'),
  created_by TEXT NOT NULL CHECK(length(created_by) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,campaign_id,lead_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES call_campaign_drafts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_call_intent_proposals_tenant
  ON call_intent_proposals(tenant_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_call_intent_proposal_immutable
BEFORE UPDATE ON call_intent_proposals
BEGIN SELECT RAISE(ABORT,'blocked call-intent proposals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_call_intent_proposal_no_provider
BEFORE INSERT ON call_intent_proposals
WHEN NEW.state!='blocked'
BEGIN SELECT RAISE(ABORT,'no customer call authorization exists'); END;
