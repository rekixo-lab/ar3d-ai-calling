-- AR3D AI Calling CRM v8, after 0007. Never use against AR3D Platform or Engine.
-- Contact classification is informational, NEVER permission for outbound calls.
PRAGMA foreign_keys=ON;
ALTER TABLE leads ADD COLUMN customer_segment TEXT NOT NULL DEFAULT 'unclassified'
  CHECK(customer_segment IN ('unclassified','prior_inquiry','unknown_contact'));
ALTER TABLE leads ADD COLUMN plot_size_preference TEXT;
ALTER TABLE leads ADD COLUMN visit_date_preference TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_tenant_segment ON leads(tenant_id,customer_segment,created_at);
