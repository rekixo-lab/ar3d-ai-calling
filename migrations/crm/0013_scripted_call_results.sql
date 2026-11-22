-- Normalized answers per campaign attempt. The lead retains its current CRM values.
CREATE TABLE IF NOT EXISTS scripted_call_results (
 tenant_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 answers_json TEXT NOT NULL CHECK(json_valid(answers_json)),
 saved_to_lead INTEGER NOT NULL CHECK(saved_to_lead IN(0,1)),
 captured_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES calling_jobs(tenant_id,id) ON DELETE CASCADE
);
