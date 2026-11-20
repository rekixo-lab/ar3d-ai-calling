-- Standalone AR3D AI Calling SHARED CRM D1 only, after 0008.
-- Additive: existing leads, calls, consent flags and all call/agent deny
-- triggers are untouched. No vendor callback route or dialer is enabled.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS voicebot_qualification_reviews (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider='exotel'),
  call_reference TEXT NOT NULL CHECK(length(call_reference) BETWEEN 12 AND 80),
  provider_account_hash TEXT NOT NULL CHECK(length(provider_account_hash)=64),
  delivery_digest TEXT NOT NULL CHECK(length(delivery_digest)=64),
  survey_json TEXT NOT NULL CHECK(length(survey_json) BETWEEN 2 AND 2048),
  source_verified INTEGER NOT NULL CHECK(source_verified=1),
  mapping_verified INTEGER NOT NULL CHECK(mapping_verified=1),
  possible_opt_out INTEGER NOT NULL DEFAULT 0 CHECK(possible_opt_out IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','dismissed')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,provider,call_reference),
  FOREIGN KEY (tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE RESTRICT,
  CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status!='pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_voicebot_reviews_tenant
 ON voicebot_qualification_reviews(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_voicebot_reviews_lead
 ON voicebot_qualification_reviews(tenant_id,lead_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_voicebot_review_terminal
BEFORE UPDATE OF status ON voicebot_qualification_reviews
WHEN OLD.status IN ('applied','dismissed')
BEGIN
  SELECT RAISE(ABORT,'final voicebot review cannot be reopened');
END;
CREATE TRIGGER IF NOT EXISTS trg_voicebot_review_immutable
BEFORE UPDATE OF tenant_id,id,lead_id,provider,call_reference,
  provider_account_hash,delivery_digest,survey_json,
  source_verified,mapping_verified,possible_opt_out,created_at
ON voicebot_qualification_reviews
BEGIN
  SELECT RAISE(ABORT,'immutable provider review evidence');
END;
