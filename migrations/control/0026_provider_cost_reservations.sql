-- Conservative provider monetary reservations. A single insert reserves BOTH
-- provider budgets and client seconds; actual expenses remain separate.
CREATE TABLE IF NOT EXISTS provider_cost_reservations (
 tenant_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 reserved_seconds INTEGER NOT NULL CHECK(typeof(reserved_seconds)='integer' AND reserved_seconds BETWEEN 30 AND 600 AND reserved_seconds%30=0),
 plivo_currency TEXT NOT NULL CHECK(plivo_currency IN ('INR','USD')),
 plivo_micros INTEGER NOT NULL CHECK(typeof(plivo_micros)='integer' AND plivo_micros BETWEEN 1 AND 1000000000000),
 sarvam_currency TEXT NOT NULL CHECK(sarvam_currency IN ('INR','USD')),
 sarvam_micros INTEGER NOT NULL CHECK(typeof(sarvam_micros)='integer' AND sarvam_micros BETWEEN 1 AND 1000000000000),
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES tenant_minute_holds(tenant_id,job_id) ON DELETE RESTRICT
);
CREATE TRIGGER IF NOT EXISTS trg_provider_reserve_hold AFTER INSERT ON provider_cost_reservations
BEGIN
 INSERT INTO tenant_minute_holds(tenant_id,job_id,reserved_seconds,created_at) VALUES(NEW.tenant_id,NEW.job_id,NEW.reserved_seconds,NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_provider_reserve_no_update BEFORE UPDATE ON provider_cost_reservations BEGIN SELECT RAISE(ABORT,'immutable provider reservation'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_reserve_no_delete BEFORE DELETE ON provider_cost_reservations BEGIN SELECT RAISE(ABORT,'immutable provider reservation'); END;
