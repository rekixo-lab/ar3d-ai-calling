-- Explicit one-use carrier authorization, independent of funding admission.
CREATE TABLE IF NOT EXISTS industry_dispatch_releases (
 tenant_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
 approved_by TEXT NOT NULL, approval_reference TEXT NOT NULL CHECK(length(trim(approval_reference)) BETWEEN 10 AND 160),
 approved_at TEXT NOT NULL, expires_at TEXT NOT NULL CHECK(expires_at>approved_at),
 state TEXT NOT NULL DEFAULT 'authorized' CHECK(state IN('authorized','claimed','posting','submitted','unknown','no_post','not_submitted')),
 session_id TEXT UNIQUE, claimed_at TEXT, updated_at TEXT NOT NULL CHECK(updated_at>=approved_at),
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES industry_funded_admissions(tenant_id,job_id) ON DELETE RESTRICT,
 CHECK((session_id IS NULL)=(claimed_at IS NULL)),
 CHECK(state NOT IN('claimed','posting','submitted','unknown') OR session_id IS NOT NULL),
 CHECK(state<>'authorized' OR session_id IS NULL),
 CHECK(claimed_at IS NULL OR (claimed_at>=approved_at AND claimed_at<expires_at AND updated_at>=claimed_at))
);
CREATE INDEX IF NOT EXISTS idx_industry_dispatch_state ON industry_dispatch_releases(state,expires_at,tenant_id,job_id);
CREATE TRIGGER IF NOT EXISTS trg_industry_dispatch_insert BEFORE INSERT ON industry_dispatch_releases
 WHEN NEW.state<>'authorized' OR NEW.session_id IS NOT NULL OR NEW.updated_at<>NEW.approved_at
 OR NOT EXISTS(SELECT 1 FROM industry_funded_admissions a JOIN industry_call_jobs j ON j.tenant_id=a.tenant_id AND j.id=a.job_id
 WHERE a.tenant_id=NEW.tenant_id AND a.job_id=NEW.job_id AND a.state IN('released','funded')
 AND j.state='prepared' AND j.purpose='school_admission' AND NEW.expires_at<=a.expires_at
 AND NEW.expires_at<=j.review_expires_at AND a.manifest_sha256=j.manifest_sha256)
 OR EXISTS(SELECT 1 FROM industry_terminal_closures z WHERE z.tenant_id=NEW.tenant_id AND z.job_id=NEW.job_id)
 BEGIN SELECT RAISE(ABORT,'invalid industry dispatch authorization'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_dispatch_update BEFORE UPDATE ON industry_dispatch_releases
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.job_id<>OLD.job_id OR NEW.approved_by<>OLD.approved_by
 OR NEW.approval_reference<>OLD.approval_reference OR NEW.approved_at<>OLD.approved_at OR NEW.expires_at<>OLD.expires_at
 OR NEW.updated_at<OLD.updated_at
 OR NOT (
 (OLD.state='authorized' AND NEW.state='claimed' AND NEW.session_id IS NOT NULL AND NEW.claimed_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM industry_funded_admissions a WHERE a.tenant_id=OLD.tenant_id AND a.job_id=OLD.job_id AND a.state='funded'))
 OR (NEW.session_id IS OLD.session_id AND NEW.claimed_at IS OLD.claimed_at AND (
 (OLD.state='authorized' AND NEW.state='no_post' AND EXISTS(SELECT 1 FROM industry_funded_admissions a WHERE a.tenant_id=OLD.tenant_id AND a.job_id=OLD.job_id AND a.state='funded'))
 OR (OLD.state='claimed' AND NEW.state IN('posting','no_post'))
 OR (OLD.state='posting' AND NEW.state IN('submitted','unknown','no_post'))
 OR (OLD.state='submitted' AND NEW.state='unknown')
 OR (OLD.state='no_post' AND NEW.state='not_submitted'))))
 BEGIN SELECT RAISE(ABORT,'immutable industry dispatch claim'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_dispatch_delete BEFORE DELETE ON industry_dispatch_releases
 BEGIN SELECT RAISE(ABORT,'immutable industry dispatch authorization'); END;
