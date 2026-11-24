-- Isolated Control D1. Unwired settlement foundation, not live dispatch authorization.
CREATE TABLE IF NOT EXISTS tenant_minute_holds (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 job_id TEXT NOT NULL,
 reserved_seconds INTEGER NOT NULL CHECK(typeof(reserved_seconds)='integer' AND reserved_seconds BETWEEN 30 AND 86400 AND reserved_seconds%30=0),
 created_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'held' CHECK(state IN ('held','settled','released')),
 charged_seconds INTEGER,
 evidence_ref TEXT,
 closed_at TEXT,
 PRIMARY KEY(tenant_id,job_id),
 CHECK((state='held' AND charged_seconds IS NULL AND evidence_ref IS NULL AND closed_at IS NULL)
 OR (state IN ('settled','released') AND typeof(charged_seconds)='integer' AND charged_seconds BETWEEN 0 AND reserved_seconds AND charged_seconds%30=0
 AND (state='settled' OR charged_seconds=0) AND evidence_ref IS NOT NULL AND length(evidence_ref) BETWEEN 1 AND 160 AND closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_minute_holds_tenant ON tenant_minute_holds(tenant_id,state);
CREATE TRIGGER IF NOT EXISTS trg_minute_hold_insert BEFORE INSERT ON tenant_minute_holds
 WHEN NEW.state<>'held' OR NEW.reserved_seconds+COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds WHERE tenant_id=NEW.tenant_id),0)>
 COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=NEW.tenant_id ORDER BY sequence DESC LIMIT 1),0)
 BEGIN SELECT RAISE(ABORT,'insufficient minute reserve'); END;
CREATE TRIGGER IF NOT EXISTS trg_minute_hold_close BEFORE UPDATE ON tenant_minute_holds
 WHEN OLD.state<>'held' OR NEW.state='held' OR NEW.tenant_id<>OLD.tenant_id OR NEW.job_id<>OLD.job_id OR NEW.reserved_seconds<>OLD.reserved_seconds OR NEW.created_at<>OLD.created_at
 BEGIN SELECT RAISE(ABORT,'immutable minute hold'); END;
CREATE TRIGGER IF NOT EXISTS trg_minute_hold_delete BEFORE DELETE ON tenant_minute_holds
 BEGIN SELECT RAISE(ABORT,'immutable minute hold'); END;
CREATE TRIGGER IF NOT EXISTS trg_minute_ledger_commitments BEFORE INSERT ON tenant_minute_ledger
 WHEN NEW.balance_seconds<COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds WHERE tenant_id=NEW.tenant_id),0)
 BEGIN SELECT RAISE(ABORT,'minutes already committed'); END;
