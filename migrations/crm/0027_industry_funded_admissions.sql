-- Shared commercial capacity/funding admission; no carrier submission.
-- A future dispatcher must add its own explicit release-to-provider transition.
CREATE TABLE IF NOT EXISTS industry_funded_admissions (
 tenant_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE, lead_id TEXT NOT NULL,
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
 max_seconds INTEGER NOT NULL CHECK(max_seconds IN(90,120,150,180)),
 approved_by TEXT NOT NULL, approval_reference TEXT NOT NULL CHECK(length(trim(approval_reference)) BETWEEN 10 AND 160),
 approved_at TEXT NOT NULL, expires_at TEXT NOT NULL CHECK(expires_at>approved_at),
 state TEXT NOT NULL DEFAULT 'released' CHECK(state IN('released','claiming','funded','blocked','unknown')),
 claimed_at TEXT, finished_at TEXT, outcome TEXT,
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES industry_call_jobs(tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id),
 CHECK((state='released' AND claimed_at IS NULL AND finished_at IS NULL AND outcome IS NULL)
 OR (state='claiming' AND claimed_at IS NOT NULL AND finished_at IS NULL AND outcome IS NULL)
 OR (state='funded' AND claimed_at IS NOT NULL AND finished_at IS NOT NULL AND outcome='funded_no_submission')
 OR (state IN('blocked','unknown') AND finished_at IS NOT NULL AND outcome IS NOT NULL AND length(outcome) BETWEEN 4 AND 80)),
 CHECK(claimed_at IS NULL OR (claimed_at>=approved_at AND claimed_at<expires_at))
);
CREATE INDEX IF NOT EXISTS idx_industry_admission_capacity ON industry_funded_admissions(state,tenant_id,lead_id);
CREATE TRIGGER IF NOT EXISTS trg_industry_admission_insert BEFORE INSERT ON industry_funded_admissions
 WHEN NEW.state<>'released' OR NOT EXISTS(
 SELECT 1 FROM industry_call_jobs j JOIN industry_campaigns c ON c.tenant_id=j.tenant_id AND c.id=j.campaign_id
 WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.job_id AND j.lead_id=NEW.lead_id AND j.state='prepared'
 AND j.manifest_sha256=NEW.manifest_sha256 AND j.review_expires_at>=NEW.expires_at AND c.archived_at IS NULL)
 OR EXISTS(SELECT 1 FROM calling_jobs p WHERE p.id=NEW.job_id)
 BEGIN SELECT RAISE(ABORT,'invalid industry admission'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_admission_update BEFORE UPDATE ON industry_funded_admissions
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.job_id<>OLD.job_id OR NEW.lead_id<>OLD.lead_id
 OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.max_seconds<>OLD.max_seconds
 OR NEW.approved_by<>OLD.approved_by OR NEW.approval_reference<>OLD.approval_reference
 OR NEW.approved_at<>OLD.approved_at OR NEW.expires_at<>OLD.expires_at
 OR NOT ((OLD.state='released' AND NEW.state='claiming' AND NEW.claimed_at IS NOT NULL)
 OR (OLD.state='released' AND NEW.state='blocked' AND NEW.claimed_at IS NULL)
 OR (OLD.state='claiming' AND NEW.state IN('funded','blocked','unknown') AND NEW.claimed_at IS OLD.claimed_at))
 BEGIN SELECT RAISE(ABORT,'immutable industry admission'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_admission_delete BEFORE DELETE ON industry_funded_admissions
 BEGIN SELECT RAISE(ABORT,'immutable industry admission'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_admission_cancel_guard BEFORE UPDATE ON industry_call_jobs
 WHEN NEW.state='cancelled' AND EXISTS(SELECT 1 FROM industry_funded_admissions a
 WHERE a.tenant_id=OLD.tenant_id AND a.job_id=OLD.id AND a.state IN('claiming','funded','unknown'))
 BEGIN SELECT RAISE(ABORT,'industry admission already claimed'); END;
