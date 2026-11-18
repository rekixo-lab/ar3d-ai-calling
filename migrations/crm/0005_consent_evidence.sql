-- AR3D AI Calling CRM only, after 0004. No client permission grants.
-- Evidence is an intake reference; only independent provider checks may clear
-- the DND / consent gate in a future audited migration.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS lead_consent_evidence (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('website_form','signed_form','in_person','other')),
  purpose TEXT NOT NULL CHECK(purpose IN ('property_information','site_visit')),
  reference TEXT NOT NULL CHECK(length(reference) BETWEEN 4 AND 160),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status='pending'),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lead_consent_evidence ON lead_consent_evidence(tenant_id,lead_id,received_at);
-- Prevent any application or operator from accidentally marking a lead as
-- cleared before the independent verification integration exists.
CREATE TRIGGER IF NOT EXISTS trg_block_unverified_consent_update
BEFORE UPDATE OF consent_status,dnd_status ON leads
WHEN NEW.consent_status='granted' OR NEW.dnd_status='allowed'
BEGIN
  SELECT RAISE(ABORT,'independent consent and DND verification not implemented');
END;
CREATE TRIGGER IF NOT EXISTS trg_block_unverified_consent_insert
BEFORE INSERT ON leads
WHEN NEW.consent_status='granted' OR NEW.dnd_status='allowed'
BEGIN
  SELECT RAISE(ABORT,'independent consent and DND verification not implemented');
END;
