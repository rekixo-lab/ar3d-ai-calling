-- Purpose-aware, non-dispatchable preparation records. No property jobs,
-- provider IDs, telephone numbers or wallet writes. A later funded dispatcher
-- must explicitly introduce a release/claim lifecycle; old records never dial
-- automatically merely because a feature flag is turned on.
CREATE TABLE IF NOT EXISTS industry_call_jobs (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, campaign_id TEXT NOT NULL,
 lead_id TEXT NOT NULL, review_revision INTEGER NOT NULL CHECK(review_revision BETWEEN 1 AND 1000),
 snapshot_id TEXT NOT NULL, graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
 purpose TEXT NOT NULL CHECK(purpose='school_admission'),
 review_expires_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','cancelled')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,campaign_id,lead_id,review_revision),
 FOREIGN KEY(tenant_id,campaign_id,lead_id,review_revision) REFERENCES industry_recipient_reviews(tenant_id,campaign_id,lead_id,revision),
 CHECK((state='prepared' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
 OR (state='cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND length(cancel_reason) BETWEEN 4 AND 160))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_job_prepared_lead ON industry_call_jobs(tenant_id,lead_id) WHERE state='prepared';
CREATE INDEX IF NOT EXISTS idx_industry_job_campaign ON industry_call_jobs(tenant_id,campaign_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS trg_industry_job_insert BEFORE INSERT ON industry_call_jobs
 WHEN NEW.state<>'prepared' OR NOT EXISTS(
  SELECT 1 FROM industry_campaigns c JOIN industry_recipient_reviews v ON v.tenant_id=c.tenant_id AND v.campaign_id=c.id
  JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id
  WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.campaign_id AND c.archived_at IS NULL
  AND c.snapshot_id=NEW.snapshot_id AND c.graph_sha256=NEW.graph_sha256 AND c.purpose=NEW.purpose
  AND v.lead_id=NEW.lead_id AND v.revision=NEW.review_revision
  AND v.revision=(SELECT MAX(r.revision) FROM industry_recipient_reviews r WHERE r.tenant_id=v.tenant_id AND r.campaign_id=v.campaign_id AND r.lead_id=v.lead_id)
  AND v.decision='cleared' AND v.expires_at=NEW.review_expires_at AND v.expires_at>NEW.created_at
  AND v.destination=l.mobile_e164 AND v.lead_updated_at=l.updated_at
  AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
  AND l.consent_status<>'denied' AND l.dnd_status<>'blocked'
  AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id))
 BEGIN SELECT RAISE(ABORT,'invalid prepared industry job'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_job_update BEFORE UPDATE ON industry_call_jobs
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.campaign_id<>OLD.campaign_id OR NEW.lead_id<>OLD.lead_id
 OR NEW.review_revision<>OLD.review_revision OR NEW.snapshot_id<>OLD.snapshot_id OR NEW.graph_sha256<>OLD.graph_sha256
 OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.purpose<>OLD.purpose OR NEW.review_expires_at<>OLD.review_expires_at
 OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR OLD.state<>'prepared' OR NEW.state<>'cancelled'
 BEGIN SELECT RAISE(ABORT,'immutable prepared industry job'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_job_delete BEFORE DELETE ON industry_call_jobs
 BEGIN SELECT RAISE(ABORT,'immutable prepared industry job'); END;
