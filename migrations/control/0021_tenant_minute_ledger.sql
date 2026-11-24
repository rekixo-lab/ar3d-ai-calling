-- Isolated AR3D Calling Control only. Separate from provisional INR plans.
-- No payment gateway, no dispatch permission, no automatic settlement.
CREATE TABLE IF NOT EXISTS tenant_minute_ledger (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('allocation','recovery')),
 delta_seconds INTEGER NOT NULL CHECK(typeof(delta_seconds)='integer' AND delta_seconds<>0 AND abs(delta_seconds)<=1000000000),
 previous_seconds INTEGER NOT NULL CHECK(typeof(previous_seconds)='integer' AND previous_seconds BETWEEN 0 AND 1000000000),
 balance_seconds INTEGER NOT NULL CHECK(typeof(balance_seconds)='integer' AND balance_seconds BETWEEN 0 AND 1000000000 AND balance_seconds=previous_seconds+delta_seconds),
 actor TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 200),
 created_at TEXT NOT NULL,
 CHECK((kind='allocation' AND delta_seconds>0) OR (kind='recovery' AND delta_seconds<0))
);
CREATE INDEX IF NOT EXISTS idx_tenant_minute_ledger ON tenant_minute_ledger(tenant_id,sequence DESC);
CREATE TRIGGER IF NOT EXISTS trg_minute_ledger_no_update BEFORE UPDATE ON tenant_minute_ledger BEGIN SELECT RAISE(ABORT,'immutable minute ledger'); END;
CREATE TRIGGER IF NOT EXISTS trg_minute_ledger_no_delete BEFORE DELETE ON tenant_minute_ledger BEGIN SELECT RAISE(ABORT,'immutable minute ledger'); END;
CREATE TRIGGER IF NOT EXISTS trg_minute_ledger_chain BEFORE INSERT ON tenant_minute_ledger
 WHEN NEW.previous_seconds<>COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=NEW.tenant_id ORDER BY sequence DESC LIMIT 1),0)
 BEGIN SELECT RAISE(ABORT,'stale minute balance'); END;
