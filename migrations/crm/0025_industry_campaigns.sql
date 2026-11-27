-- Production CRM: additive industry campaigns and independently reviewed
-- recipient permissions. These are NOT jobs, provider authorizations or holds.
CREATE TABLE IF NOT EXISTS industry_campaigns (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 launch_request_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 purpose TEXT NOT NULL CHECK(purpose='school_admission'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 archived_by TEXT,
 archived_at TEXT,
 PRIMARY KEY(tenant_id,id),
 CHECK((archived_by IS NULL)=(archived_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_industry_campaigns_tenant ON industry_campaigns(tenant_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS industry_campaign_candidates (
 tenant_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 added_by TEXT NOT NULL,
 added_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,campaign_id,lead_id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES industry_campaigns(tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS industry_recipient_reviews (
 tenant_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 decision TEXT NOT NULL CHECK(decision IN('cleared','revoked')),
 destination TEXT,
 lead_updated_at TEXT,
 consent_ref TEXT,
 dnd_ref TEXT,
 expires_at TEXT,
 reason TEXT,
 reviewed_by TEXT NOT NULL,
 reviewed_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,campaign_id,lead_id,revision),
 FOREIGN KEY(tenant_id,campaign_id,lead_id) REFERENCES industry_campaign_candidates(tenant_id,campaign_id,lead_id),
 CHECK((decision='cleared' AND destination IS NOT NULL AND lead_updated_at IS NOT NULL
   AND consent_ref IS NOT NULL AND length(consent_ref) BETWEEN 4 AND 160
   AND dnd_ref IS NOT NULL AND length(dnd_ref) BETWEEN 4 AND 160
   AND expires_at IS NOT NULL AND expires_at>reviewed_at AND reason IS NULL)
 OR (decision='revoked' AND destination IS NULL AND lead_updated_at IS NULL AND consent_ref IS NULL
   AND dnd_ref IS NULL AND expires_at IS NULL AND reason IS NOT NULL AND length(reason) BETWEEN 4 AND 160))
);
CREATE TRIGGER IF NOT EXISTS trg_industry_campaign_guard BEFORE UPDATE ON industry_campaigns
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.launch_request_id<>OLD.launch_request_id
 OR NEW.snapshot_id<>OLD.snapshot_id OR NEW.graph_sha256<>OLD.graph_sha256 OR NEW.purpose<>OLD.purpose
 OR NEW.name<>OLD.name OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
 OR OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL
 BEGIN SELECT RAISE(ABORT,'immutable industry campaign'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_campaign_no_delete BEFORE DELETE ON industry_campaigns
 BEGIN SELECT RAISE(ABORT,'immutable industry campaign'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_candidate_no_update BEFORE UPDATE ON industry_campaign_candidates
 BEGIN SELECT RAISE(ABORT,'immutable industry campaign candidate'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_candidate_no_delete BEFORE DELETE ON industry_campaign_candidates
 BEGIN SELECT RAISE(ABORT,'immutable industry campaign candidate'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_review_no_update BEFORE UPDATE ON industry_recipient_reviews
 BEGIN SELECT RAISE(ABORT,'immutable industry recipient review'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_review_no_delete BEFORE DELETE ON industry_recipient_reviews
 BEGIN SELECT RAISE(ABORT,'immutable industry recipient review'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_review_sequence BEFORE INSERT ON industry_recipient_reviews
 WHEN NEW.revision<>1+COALESCE((SELECT MAX(r.revision) FROM industry_recipient_reviews r
  WHERE r.tenant_id=NEW.tenant_id AND r.campaign_id=NEW.campaign_id AND r.lead_id=NEW.lead_id),0)
 BEGIN SELECT RAISE(ABORT,'invalid industry review revision'); END;
