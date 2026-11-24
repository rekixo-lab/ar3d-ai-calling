-- One confirmed external receipt buys a fixed number of non-expiring seconds.
-- Purchase and credit allocation occur in the same SQLite statement.
CREATE TABLE IF NOT EXISTS tenant_credit_purchases (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 receipt_ref TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(receipt_ref) BETWEEN 4 AND 120),
 paid_paise INTEGER NOT NULL CHECK(typeof(paid_paise)='integer' AND paid_paise BETWEEN 1 AND 1000000000),
 purchased_seconds INTEGER NOT NULL CHECK(typeof(purchased_seconds)='integer' AND purchased_seconds BETWEEN 60 AND 999999960 AND purchased_seconds%60=0),
 previous_seconds INTEGER NOT NULL CHECK(typeof(previous_seconds)='integer' AND previous_seconds BETWEEN 0 AND 1000000000 AND previous_seconds+purchased_seconds<=1000000000),
 actor TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_tenant ON tenant_credit_purchases(tenant_id,sequence DESC);
CREATE TRIGGER IF NOT EXISTS trg_credit_purchase_no_update BEFORE UPDATE ON tenant_credit_purchases BEGIN SELECT RAISE(ABORT,'immutable credit purchase'); END;
CREATE TRIGGER IF NOT EXISTS trg_credit_purchase_no_delete BEFORE DELETE ON tenant_credit_purchases BEGIN SELECT RAISE(ABORT,'immutable credit purchase'); END;
CREATE TRIGGER IF NOT EXISTS trg_credit_purchase_allocate AFTER INSERT ON tenant_credit_purchases
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id AND status IN ('trial','active')) THEN RAISE(ABORT,'purchase tenant unavailable') END;
 INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at)
 VALUES('purchase:'||NEW.id,NEW.tenant_id,'allocation',NEW.purchased_seconds,NEW.previous_seconds,NEW.previous_seconds+NEW.purchased_seconds,NEW.actor,'Confirmed external payment purchase',NEW.created_at);
END;
