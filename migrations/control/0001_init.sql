-- Standalone control plane. Never run against AR3D Platform or Engine production DB.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  plan_code TEXT NOT NULL CHECK(plan_code IN ('starter','growth','enterprise')),
  storage_mode TEXT NOT NULL CHECK(storage_mode IN ('shared','dedicated')),
  dedicated_binding TEXT,
  status TEXT NOT NULL DEFAULT 'trial' CHECK(status IN ('trial','active','suspended','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((storage_mode='shared' AND dedicated_binding IS NULL) OR
        (storage_mode='dedicated'))
);
CREATE TABLE IF NOT EXISTS tenant_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('client_admin','integrator')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tenant_keys_tenant ON tenant_keys(tenant_id,active);
CREATE TABLE IF NOT EXISTS project_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('ar3d-platform','ar3d-engine')),
  external_project_id TEXT NOT NULL,
  external_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','disabled')),
  created_at TEXT NOT NULL,
  UNIQUE(source,external_project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_links_tenant ON project_links(tenant_id);
CREATE TABLE IF NOT EXISTS tenant_numbers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  e164 TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_number_id TEXT,
  classification TEXT NOT NULL CHECK(classification IN ('promotional','service','other')),
  compliance_state TEXT NOT NULL DEFAULT 'pending' CHECK(compliance_state IN ('pending','approved','disabled')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended','released')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_numbers_owner ON tenant_numbers(tenant_id,status);
CREATE TABLE IF NOT EXISTS tenant_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
