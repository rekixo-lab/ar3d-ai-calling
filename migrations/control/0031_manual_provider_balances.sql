-- Owner-entered current available balances. These are observations, not
-- recharge receipts. No balance, rate or enabled control is seeded here.
CREATE TABLE IF NOT EXISTS provider_balance_snapshots (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 provider TEXT NOT NULL CHECK(provider IN('plivo','sarvam')),
 currency TEXT NOT NULL CHECK(currency='INR'),
 balance_micros INTEGER NOT NULL CHECK(typeof(balance_micros)='integer' AND balance_micros BETWEEN 0 AND 999999999999),
 actor TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
);
CREATE INDEX IF NOT EXISTS idx_provider_balance_latest ON provider_balance_snapshots(provider,sequence DESC);
CREATE TRIGGER IF NOT EXISTS trg_provider_balance_no_update BEFORE UPDATE ON provider_balance_snapshots
BEGIN SELECT RAISE(ABORT,'immutable provider balance snapshot'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_balance_no_delete BEFORE DELETE ON provider_balance_snapshots
BEGIN SELECT RAISE(ABORT,'immutable provider balance snapshot'); END;

-- A settled call is excluded only after an operator copies a newer current
-- balance. Held/unknown and recently closed calls retain their liability.
-- Coverage is once per provider/call; later cost reconciliation cannot mint
-- extra capacity from a frozen numerical baseline.
CREATE TABLE IF NOT EXISTS provider_balance_covered_calls (
 provider TEXT NOT NULL CHECK(provider IN('plivo','sarvam')),
 tenant_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 snapshot_sequence INTEGER NOT NULL REFERENCES provider_balance_snapshots(sequence) ON DELETE RESTRICT,
 PRIMARY KEY(provider,tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES provider_cost_reservations(tenant_id,job_id) ON DELETE RESTRICT
);
CREATE TRIGGER IF NOT EXISTS trg_provider_balance_cover_validate BEFORE INSERT ON provider_balance_covered_calls
WHEN NOT EXISTS(SELECT 1 FROM provider_balance_snapshots s JOIN tenant_minute_holds h
 ON h.tenant_id=NEW.tenant_id AND h.job_id=NEW.job_id
 WHERE s.sequence=NEW.snapshot_sequence AND s.provider=NEW.provider AND h.state='settled'
 AND h.closed_at<=strftime('%Y-%m-%dT%H:%M:%fZ',s.created_at,'-60 seconds'))
BEGIN SELECT RAISE(ABORT,'only posted settled calls may be covered'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_balance_cover_no_update BEFORE UPDATE ON provider_balance_covered_calls
BEGIN SELECT RAISE(ABORT,'immutable provider balance coverage'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_balance_cover_no_delete BEFORE DELETE ON provider_balance_covered_calls
BEGIN SELECT RAISE(ABORT,'immutable provider balance coverage'); END;

CREATE TABLE IF NOT EXISTS provider_manual_funding_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled INTEGER NOT NULL CHECK(typeof(enabled)='integer' AND enabled IN(0,1)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 2147483647),
 updated_by TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL CHECK(length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at)
);
CREATE TRIGGER IF NOT EXISTS trg_provider_manual_control_no_delete BEFORE DELETE ON provider_manual_funding_control
BEGIN SELECT RAISE(ABORT,'manual funding control cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_manual_control_revision BEFORE UPDATE ON provider_manual_funding_control
WHEN NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'manual funding revision must advance once'); END;
