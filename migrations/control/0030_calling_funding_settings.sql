-- Operator-reviewed provider tariff envelopes, kept in Calling Control so
-- recorded funding can be used without changing Worker variables. No row,
-- rates or money are seeded by this migration. The application requires
-- current Super Admin MFA and records changes in its existing audit trail.
CREATE TABLE IF NOT EXISTS calling_funding_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 mode TEXT NOT NULL CHECK(mode IN('journal','disabled')),
 plivo_currency TEXT NOT NULL CHECK(plivo_currency IN('INR','USD')),
 plivo_pulse_micros INTEGER NOT NULL CHECK(typeof(plivo_pulse_micros)='integer' AND plivo_pulse_micros BETWEEN 1 AND 1000000000),
 sarvam_currency TEXT NOT NULL CHECK(sarvam_currency='INR'),
 sarvam_pulse_micros INTEGER NOT NULL CHECK(typeof(sarvam_pulse_micros)='integer' AND sarvam_pulse_micros BETWEEN 1 AND 1000000000),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 10 AND 160),
 updated_by TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL CHECK(length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at)
);
-- A disabled row is retained so it cannot silently revert to legacy Worker
-- values. Writers must compare the expected revision before updating.
CREATE TRIGGER IF NOT EXISTS trg_calling_funding_no_delete
BEFORE DELETE ON calling_funding_settings
BEGIN SELECT RAISE(ABORT,'calling funding settings cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_calling_funding_revision
BEFORE UPDATE ON calling_funding_settings
WHEN NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'calling funding settings revision must advance once'); END;
