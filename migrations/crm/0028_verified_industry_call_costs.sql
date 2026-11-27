-- Shared CRM: verified industry CDR observations only. No dispatch or capacity release.
CREATE TABLE IF NOT EXISTS verified_industry_call_costs (
 tenant_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL UNIQUE, provider_request_id TEXT NOT NULL UNIQUE,
 provider_call_uuid TEXT NOT NULL UNIQUE,
 reported_amount TEXT NOT NULL CHECK(length(reported_amount) BETWEEN 1 AND 32),
 billed_seconds INTEGER NOT NULL CHECK(typeof(billed_seconds)='integer' AND billed_seconds BETWEEN 0 AND 86400),
 call_seconds INTEGER NOT NULL CHECK(typeof(call_seconds)='integer' AND call_seconds BETWEEN 0 AND billed_seconds),
 currency_status TEXT NOT NULL DEFAULT 'unverified' CHECK(currency_status='unverified'),
 hangup_at INTEGER NOT NULL CHECK(typeof(hangup_at)='integer' AND hangup_at>=0),
 verified_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES industry_funded_admissions(tenant_id,job_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_verified_industry_cost_tenant ON verified_industry_call_costs(tenant_id,verified_at);
CREATE TRIGGER IF NOT EXISTS trg_industry_cdr_insert BEFORE INSERT ON verified_industry_call_costs
 WHEN NOT EXISTS(SELECT 1 FROM industry_funded_admissions a JOIN industry_call_jobs j ON j.tenant_id=a.tenant_id AND j.id=a.job_id
 WHERE a.tenant_id=NEW.tenant_id AND a.job_id=NEW.job_id AND a.state='funded' AND j.state='prepared' AND j.purpose='school_admission')
 OR EXISTS(SELECT 1 FROM calling_jobs p WHERE p.id=NEW.job_id OR p.provider_call_sid=NEW.provider_call_uuid)
 OR EXISTS(SELECT 1 FROM verified_provider_call_costs p WHERE p.provider_call_uuid=NEW.provider_call_uuid)
 BEGIN SELECT RAISE(ABORT,'invalid industry CDR identity'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_cdr_update BEFORE UPDATE ON verified_industry_call_costs
 BEGIN SELECT RAISE(ABORT,'immutable industry CDR'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_cdr_delete BEFORE DELETE ON verified_industry_call_costs
 BEGIN SELECT RAISE(ABORT,'immutable industry CDR'); END;
