-- Persistent provider fault interlock. No record grants funding or dial permission.
CREATE TABLE IF NOT EXISTS provider_safety_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 provider TEXT NOT NULL CHECK(provider IN ('plivo','sarvam')),
 kind TEXT NOT NULL CHECK(kind IN ('blocked','reviewed')),
 code TEXT NOT NULL CHECK(length(code) BETWEEN 3 AND 40),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 4 AND 160),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(provider,kind,evidence_ref)
);
CREATE INDEX IF NOT EXISTS idx_provider_safety_latest ON provider_safety_events(provider,sequence DESC);
CREATE TRIGGER IF NOT EXISTS trg_provider_safety_no_update BEFORE UPDATE ON provider_safety_events BEGIN SELECT RAISE(ABORT,'immutable provider safety history'); END;
CREATE TRIGGER IF NOT EXISTS trg_provider_safety_no_delete BEFORE DELETE ON provider_safety_events BEGIN SELECT RAISE(ABORT,'immutable provider safety history'); END;
