-- Isolated Calling CRM. Existing prototype calls/agents/consent guards stay intact.
PRAGMA foreign_keys=ON;
CREATE TABLE calling_policies (
 tenant_id TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 flow_id TEXT NOT NULL,
 approval_reference TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 100),
 max_seconds INTEGER NOT NULL CHECK(max_seconds BETWEEN 30 AND 600),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE calling_clearances (
 tenant_id TEXT NOT NULL, lead_id TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN('property_information','site_visit')),
 consent_reference TEXT NOT NULL, dnd_reference TEXT NOT NULL,
 expires_at TEXT NOT NULL, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,lead_id,purpose),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE calling_runs (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('running','paused','completed')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,campaign_id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES call_campaign_drafts(tenant_id,id)
);
CREATE TABLE calling_jobs (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, run_id TEXT NOT NULL, lead_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN('queued','reserved','submitted','completed','failed','blocked','unknown')),
 account_sid TEXT, caller_id TEXT, flow_id TEXT, destination TEXT,
 provider_call_sid TEXT UNIQUE, provider_status TEXT, duration_seconds INTEGER,
 error_code TEXT, reserved_at TEXT, checked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,run_id,lead_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES calling_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
-- A lost network response or crashed reservation locks the tenant until reviewed.
CREATE UNIQUE INDEX calling_one_inflight ON calling_jobs(tenant_id)
 WHERE state IN('reserved','submitted','unknown');
CREATE INDEX calling_job_queue ON calling_jobs(tenant_id,state,created_at);
CREATE INDEX calling_job_daily ON calling_jobs(tenant_id,reserved_at);
