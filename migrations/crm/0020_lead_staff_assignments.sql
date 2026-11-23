-- AR3D AI Calling CRM D1 only; one lead assigned to one existing member of the same tenant.
-- Human identities live in separate CONTROL D1, so membership MUST be checked by handler.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS lead_staff_assignments (
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 user_id TEXT,
 assigned_by TEXT NOT NULL,
 assigned_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,lead_id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lead_staff_by_assignee ON lead_staff_assignments(tenant_id,user_id,assigned_at);
