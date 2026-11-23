-- Only the isolated AR3D AI Calling CONTROL D1. Migrate existing DBs manually
-- after backup and schema review. DO NOT apply to AR3D Platform or Engine.
-- This is NOT a wallet usable for live billing until verified provider-rated CDR
-- settlement and a carrier-backed currency-matched funding pool are available.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tenant_credit_budgets (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
 planned_paise INTEGER NOT NULL DEFAULT 0 CHECK(planned_paise>=0 AND planned_paise<=100000000),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_credit_audit (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 actor TEXT NOT NULL,
 previous_paise INTEGER NOT NULL CHECK(previous_paise>=0),
 new_paise INTEGER NOT NULL CHECK(new_paise>=0),
 reason TEXT NOT NULL CHECK(length(reason)>=10 AND length(reason)<=200),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_credit_audit ON tenant_credit_audit(tenant_id,created_at);
-- Calling remains blocked by the existing telecom, company and customer gates.
-- This schema intentionally has NO automatic 'spend' or 'grant calls' trigger.
