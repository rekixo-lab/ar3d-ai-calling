-- Allow several simultaneous calls per company. The scheduler enforces the
-- per-company and platform limits; an uncertain ('unknown') call still locks
-- that company's new dispatch until a Super Admin reviews it.
DROP INDEX IF EXISTS calling_one_inflight;
CREATE INDEX IF NOT EXISTS calling_job_inflight ON calling_jobs(tenant_id,state)
 WHERE state IN('reserved','submitted','unknown');
