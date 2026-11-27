-- Release a shared calling slot only after verified CDR and settled hold evidence.
-- The server adapter verifies the immutable Control D1 hold; this CRM trigger
-- independently binds the closure to the exact immutable CRM receipt.
CREATE TABLE IF NOT EXISTS industry_terminal_closures (
 tenant_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL UNIQUE, provider_call_uuid TEXT NOT NULL UNIQUE,
 hangup_at INTEGER NOT NULL CHECK(typeof(hangup_at)='integer' AND hangup_at>=0),
 billed_seconds INTEGER NOT NULL CHECK(typeof(billed_seconds)='integer' AND billed_seconds BETWEEN 0 AND 180 AND billed_seconds%30=0),
 settled_at TEXT NOT NULL, closed_at TEXT NOT NULL CHECK(closed_at>=settled_at),
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES verified_industry_call_costs(tenant_id,job_id) ON DELETE RESTRICT
);
CREATE TRIGGER IF NOT EXISTS trg_industry_terminal_insert BEFORE INSERT ON industry_terminal_closures
 WHEN NOT EXISTS(SELECT 1 FROM verified_industry_call_costs c
 JOIN industry_funded_admissions a ON a.tenant_id=c.tenant_id AND a.job_id=c.job_id
 JOIN industry_call_jobs j ON j.tenant_id=c.tenant_id AND j.id=c.job_id
 WHERE c.tenant_id=NEW.tenant_id AND c.job_id=NEW.job_id AND c.session_id=NEW.session_id
 AND c.provider_call_uuid=NEW.provider_call_uuid AND c.hangup_at=NEW.hangup_at
 AND c.billed_seconds=NEW.billed_seconds AND c.verified_at<=NEW.settled_at
 AND a.state='funded' AND c.billed_seconds<=a.max_seconds AND j.state='prepared')
 BEGIN SELECT RAISE(ABORT,'invalid industry terminal evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_terminal_update BEFORE UPDATE ON industry_terminal_closures
 BEGIN SELECT RAISE(ABORT,'immutable industry terminal closure'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_terminal_delete BEFORE DELETE ON industry_terminal_closures
 BEGIN SELECT RAISE(ABORT,'immutable industry terminal closure'); END;
