-- AR3D AI Calling CRM only. Run after 0003 on NEW or reviewed CRM D1.
-- Stores one-way contact suppression provenance for future compliant calling.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS lead_opt_out_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('customer_request','admin_action','other')),
  reason TEXT CHECK(reason IS NULL OR length(reason)<=500),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_lead_opt_out_events ON lead_opt_out_events(tenant_id,lead_id,created_at);
-- Denied/blocked states cannot be silently reset after an opt-out event exists.
CREATE TRIGGER IF NOT EXISTS trg_prevent_lead_opt_out_reversal
BEFORE UPDATE OF consent_status,dnd_status ON leads
WHEN EXISTS (SELECT 1 FROM lead_opt_out_events e
  WHERE e.tenant_id=OLD.tenant_id AND e.lead_id=OLD.id)
AND (NEW.consent_status!='denied' OR NEW.dnd_status!='blocked')
BEGIN
  SELECT RAISE(ABORT,'lead is opted out: calling remains blocked');
END;
