-- Manual evidence-based provider accounting; not a funding or dispatch grant.
CREATE TABLE IF NOT EXISTS provider_financial_journal (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 provider TEXT NOT NULL CHECK(provider IN ('plivo','sarvam')),
 currency TEXT NOT NULL CHECK(currency IN ('INR','USD')),
 kind TEXT NOT NULL CHECK(kind IN ('opening','topup','expense','refund')),
 amount_micros INTEGER NOT NULL CHECK(typeof(amount_micros)='integer' AND amount_micros BETWEEN 1 AND 1000000000000),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 4 AND 120),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 200),
 actor TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 UNIQUE(provider,evidence_ref)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_journal_opening ON provider_financial_journal(provider,currency) WHERE kind='opening';
CREATE INDEX IF NOT EXISTS idx_provider_journal_account ON provider_financial_journal(provider,currency,sequence DESC);
CREATE TRIGGER IF NOT EXISTS trg_provider_journal_no_update BEFORE UPDATE ON provider_financial_journal BEGIN SELECT RAISE(ABORT,'immutable provider journal'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_journal_no_delete BEFORE DELETE ON provider_financial_journal BEGIN SELECT RAISE(ABORT,'immutable provider journal'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_journal_opening_first BEFORE INSERT ON provider_financial_journal WHEN NEW.kind='opening' AND EXISTS(SELECT 1 FROM provider_financial_journal WHERE provider=NEW.provider AND currency=NEW.currency) BEGIN SELECT RAISE(ABORT,'opening must be first'); END;
