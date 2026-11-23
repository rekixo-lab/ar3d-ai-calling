-- AR3D AI Calling CRM ONLY. Immutable, tenant-scoped provider CDR observation.
-- Reported amounts use Plivo's raw format. No currency assertion, no wallet
-- debit, no negative balance and no permission to dial comes from this table.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS verified_provider_call_costs (
 tenant_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 provider_call_uuid TEXT NOT NULL,
 reported_amount TEXT NOT NULL CHECK(length(reported_amount) BETWEEN 1 AND 32),
 billed_seconds INTEGER NOT NULL CHECK(billed_seconds>=0 AND billed_seconds<=86400),
 call_seconds INTEGER NOT NULL CHECK(call_seconds>=0 AND call_seconds<=86400),
 currency_status TEXT NOT NULL DEFAULT 'unverified' CHECK(currency_status='unverified'),
 verified_by TEXT NOT NULL,
 verified_at TEXT NOT NULL,
 PRIMARY KEY (tenant_id,job_id),
 UNIQUE (tenant_id,provider_call_uuid),
 FOREIGN KEY (tenant_id,job_id) REFERENCES calling_jobs(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_verified_provider_cost_tenant
 ON verified_provider_call_costs(tenant_id,verified_at);
