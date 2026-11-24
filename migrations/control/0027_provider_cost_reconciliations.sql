-- Operator-reviewed per-call expense attribution. Never creates client credits.
CREATE TABLE IF NOT EXISTS provider_cost_reconciliations (
 tenant_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('plivo','sarvam')),
 currency TEXT NOT NULL CHECK(currency IN ('USD','INR')),
 actual_micros INTEGER NOT NULL CHECK(typeof(actual_micros)='integer' AND actual_micros BETWEEN 0 AND 1000000000000),
 journal_id TEXT UNIQUE REFERENCES provider_financial_journal(id) ON DELETE RESTRICT,
 evidence_ref TEXT NOT NULL COLLATE NOCASE CHECK(length(evidence_ref) BETWEEN 4 AND 120),
 actor TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,job_id,provider),
 UNIQUE(provider,evidence_ref),
 FOREIGN KEY(tenant_id,job_id) REFERENCES provider_cost_reservations(tenant_id,job_id) ON DELETE RESTRICT,
 CHECK((actual_micros=0 AND journal_id IS NULL) OR (actual_micros>0 AND journal_id IS NOT NULL))
);
CREATE TRIGGER IF NOT EXISTS trg_provider_cost_reconcile_validate BEFORE INSERT ON provider_cost_reconciliations
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id
 WHERE r.tenant_id=NEW.tenant_id AND r.job_id=NEW.job_id AND h.state='settled'
 AND NEW.currency=CASE NEW.provider WHEN 'plivo' THEN r.plivo_currency ELSE r.sarvam_currency END)
 THEN RAISE(ABORT,'settled matching reservation required') END;
 SELECT CASE WHEN NEW.actual_micros>0 AND NOT EXISTS(SELECT 1 FROM provider_financial_journal j WHERE j.id=NEW.journal_id AND j.provider=NEW.provider AND j.currency=NEW.currency AND j.kind='expense' AND j.amount_micros=NEW.actual_micros AND j.evidence_ref=NEW.evidence_ref COLLATE BINARY)
 THEN RAISE(ABORT,'matching expense evidence required') END;
 SELECT CASE WHEN NEW.actual_micros=0 AND EXISTS(SELECT 1 FROM provider_financial_journal j WHERE j.provider=NEW.provider AND j.evidence_ref=NEW.evidence_ref COLLATE NOCASE)
 THEN RAISE(ABORT,'zero-cost evidence conflicts with journal') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_provider_cost_reconcile_overrun AFTER INSERT ON provider_cost_reconciliations
WHEN NEW.actual_micros>(SELECT CASE NEW.provider WHEN 'plivo' THEN plivo_micros ELSE sarvam_micros END FROM provider_cost_reservations WHERE tenant_id=NEW.tenant_id AND job_id=NEW.job_id)
BEGIN
 INSERT INTO provider_safety_events(provider,kind,code,evidence_ref,actor,created_at)
 VALUES(NEW.provider,'blocked','cost_over_reserve','reconcile:'||NEW.tenant_id||':'||NEW.job_id,'system',NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_provider_cost_reconcile_no_update BEFORE UPDATE ON provider_cost_reconciliations BEGIN SELECT RAISE(ABORT,'immutable provider reconciliation'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_cost_reconcile_no_delete BEFORE DELETE ON provider_cost_reconciliations BEGIN SELECT RAISE(ABORT,'immutable provider reconciliation'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_cost_zero_evidence_guard BEFORE INSERT ON provider_financial_journal
WHEN EXISTS(SELECT 1 FROM provider_cost_reconciliations r WHERE r.provider=NEW.provider AND r.evidence_ref=NEW.evidence_ref COLLATE NOCASE AND r.actual_micros=0)
BEGIN SELECT RAISE(ABORT,'zero-cost evidence already attributed'); END;
