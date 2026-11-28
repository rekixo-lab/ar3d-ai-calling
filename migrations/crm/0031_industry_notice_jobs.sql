-- Additive: never relabel School jobs or rebuild existing production tables.
-- No seeds, credit writes, calls, or default recipient authorizations.
CREATE TABLE IF NOT EXISTS industry_notice_jobs (
 tenant_id TEXT NOT NULL,id TEXT NOT NULL UNIQUE,lead_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 template_id TEXT NOT NULL CHECK(template_id IN('appointment_reminder_v1','finance_due_notice_v1','banking_service_v1','insurance_renewal_v1')),
 language TEXT NOT NULL CHECK(language IN('hi','en')),
 delivery_mode TEXT NOT NULL CHECK(delivery_mode IN('general','verified')),
 destination TEXT NOT NULL CHECK(destination GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
 lead_updated_at TEXT NOT NULL,
 review_sha256 TEXT NOT NULL CHECK(length(review_sha256)=64 AND review_sha256 NOT GLOB '*[^0-9a-f]*'),
 consent_ref TEXT NOT NULL CHECK(length(consent_ref) BETWEEN 4 AND 160),
 dnd_ref TEXT NOT NULL CHECK(length(dnd_ref) BETWEEN 4 AND 160),
 provider_ref TEXT NOT NULL CHECK(length(provider_ref) BETWEEN 10 AND 160),
 private_speech_ref TEXT CHECK(private_speech_ref IS NULL OR length(private_speech_ref) BETWEEN 10 AND 160),
 reviewed_by TEXT NOT NULL,reviewed_at INTEGER NOT NULL,review_expires_at INTEGER NOT NULL CHECK(review_expires_at>reviewed_at AND review_expires_at<=reviewed_at+7776000000),
 state TEXT NOT NULL DEFAULT 'reviewed' CHECK(state IN('reviewed','authorized','claiming','funded','claimed','posting','submitted','unknown','no_post','not_submitted','blocked','revoked','receipt','settled')),
 actor_id TEXT,authorized_at INTEGER,release_expires_at INTEGER,
 claimed_at INTEGER,session_id TEXT UNIQUE,
 revoked_at INTEGER,revoked_by TEXT,
 updated_at INTEGER NOT NULL CHECK(updated_at>=reviewed_at),
 request_id TEXT UNIQUE,call_uuid TEXT UNIQUE,hangup_at INTEGER,
 billed_seconds INTEGER CHECK(billed_seconds BETWEEN 0 AND 90 AND billed_seconds%30=0),
 connected_seconds INTEGER CHECK(connected_seconds BETWEEN 0 AND billed_seconds),
 reported_amount TEXT CHECK(length(reported_amount) BETWEEN 1 AND 32),
 result TEXT CHECK(result IN('announcement_issued','declined','ended','needs_review')),
 verified_at INTEGER,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id) ON DELETE RESTRICT,
 CHECK((delivery_mode='verified')=(private_speech_ref IS NOT NULL)),
 CHECK((actor_id IS NULL AND authorized_at IS NULL AND release_expires_at IS NULL) OR
       (actor_id IS NOT NULL AND authorized_at>=reviewed_at AND release_expires_at>authorized_at AND release_expires_at<=authorized_at+3600000 AND release_expires_at<=review_expires_at)),
 CHECK(state IN('reviewed','revoked') OR actor_id IS NOT NULL),
 CHECK(claimed_at IS NULL OR (authorized_at IS NOT NULL AND claimed_at>=authorized_at AND claimed_at<release_expires_at)),
 CHECK(state NOT IN('claiming','funded','claimed','posting','submitted','unknown','no_post','not_submitted','receipt','settled') OR claimed_at IS NOT NULL),
 CHECK(state NOT IN('claimed','posting','submitted','receipt','settled') OR session_id IS NOT NULL),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL)),
 CHECK((state IN('receipt','settled') AND request_id IS NOT NULL AND call_uuid IS NOT NULL AND hangup_at IS NOT NULL AND billed_seconds IS NOT NULL AND connected_seconds IS NOT NULL AND reported_amount IS NOT NULL AND result IS NOT NULL AND verified_at IS NOT NULL) OR
       (state NOT IN('receipt','settled') AND request_id IS NULL AND call_uuid IS NULL AND hangup_at IS NULL AND billed_seconds IS NULL AND connected_seconds IS NULL AND reported_amount IS NULL AND result IS NULL AND verified_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notice_active_lead ON industry_notice_jobs(tenant_id,lead_id)
 WHERE state NOT IN('settled','not_submitted','blocked','revoked');
CREATE INDEX IF NOT EXISTS idx_notice_queue ON industry_notice_jobs(state,release_expires_at,tenant_id,id);
CREATE INDEX IF NOT EXISTS idx_notice_tenant ON industry_notice_jobs(tenant_id,reviewed_at DESC,id);
CREATE TRIGGER IF NOT EXISTS trg_notice_job_insert BEFORE INSERT ON industry_notice_jobs
 WHEN NEW.state<>'reviewed' OR NEW.updated_at<>NEW.reviewed_at OR NEW.actor_id IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.session_id IS NOT NULL OR NEW.revoked_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM calling_jobs p WHERE p.id=NEW.id)
 OR EXISTS(SELECT 1 FROM industry_call_jobs p WHERE p.id=NEW.id)
 OR NOT EXISTS(SELECT 1 FROM leads l WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.lead_id
  AND l.mobile_e164=NEW.destination AND l.updated_at=NEW.lead_updated_at AND l.consent_status<>'denied' AND l.dnd_status<>'blocked'
  AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id))
 BEGIN SELECT RAISE(ABORT,'invalid notice review'); END;
CREATE TRIGGER IF NOT EXISTS trg_notice_job_update BEFORE UPDATE ON industry_notice_jobs
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.lead_id<>OLD.lead_id
 OR NEW.snapshot_id<>OLD.snapshot_id OR NEW.graph_sha256<>OLD.graph_sha256 OR NEW.template_id<>OLD.template_id
 OR NEW.language<>OLD.language OR NEW.delivery_mode<>OLD.delivery_mode OR NEW.destination<>OLD.destination
 OR NEW.lead_updated_at<>OLD.lead_updated_at OR NEW.review_sha256<>OLD.review_sha256 OR NEW.consent_ref<>OLD.consent_ref
 OR NEW.dnd_ref<>OLD.dnd_ref OR NEW.provider_ref<>OLD.provider_ref OR NEW.private_speech_ref IS NOT OLD.private_speech_ref
 OR NEW.reviewed_by<>OLD.reviewed_by OR NEW.reviewed_at<>OLD.reviewed_at OR NEW.review_expires_at<>OLD.review_expires_at
 OR NEW.updated_at<OLD.updated_at
 OR (NOT(OLD.state='reviewed' AND NEW.state='authorized') AND (NEW.actor_id IS NOT OLD.actor_id OR NEW.authorized_at IS NOT OLD.authorized_at OR NEW.release_expires_at IS NOT OLD.release_expires_at))
 OR (NOT(OLD.state='authorized' AND NEW.state='claiming') AND NEW.claimed_at IS NOT OLD.claimed_at)
 OR (NOT(OLD.state='funded' AND NEW.state='claimed') AND NEW.session_id IS NOT OLD.session_id)
 OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by))
 OR (OLD.state='receipt' AND (NEW.request_id IS NOT OLD.request_id OR NEW.call_uuid IS NOT OLD.call_uuid OR NEW.hangup_at IS NOT OLD.hangup_at
   OR NEW.billed_seconds IS NOT OLD.billed_seconds OR NEW.connected_seconds IS NOT OLD.connected_seconds OR NEW.reported_amount IS NOT OLD.reported_amount
   OR NEW.result IS NOT OLD.result OR NEW.verified_at IS NOT OLD.verified_at))
 OR NOT(
 (OLD.state='reviewed' AND NEW.state IN('authorized','revoked'))
 OR (OLD.state='authorized' AND NEW.state IN('claiming','revoked'))
 OR (OLD.state='claiming' AND NEW.state IN('funded','blocked','unknown','no_post'))
 OR (OLD.state='funded' AND NEW.state IN('claimed','no_post'))
 OR (OLD.state='claimed' AND NEW.state IN('posting','no_post'))
 OR (OLD.state='posting' AND NEW.state IN('submitted','unknown','no_post','receipt'))
 OR (OLD.state='submitted' AND NEW.state IN('unknown','receipt'))
 OR (OLD.state='unknown' AND NEW.state='receipt' AND OLD.session_id IS NOT NULL)
 OR (OLD.state='no_post' AND NEW.state='not_submitted')
 OR (OLD.state='receipt' AND NEW.state='settled')
 OR (OLD.state=NEW.state AND OLD.state IN('claiming','funded','claimed','posting','submitted','unknown','receipt','no_post') AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
 )
 BEGIN SELECT RAISE(ABORT,'immutable notice job transition'); END;
CREATE TRIGGER IF NOT EXISTS trg_notice_job_delete BEFORE DELETE ON industry_notice_jobs
 BEGIN SELECT RAISE(ABORT,'immutable notice job'); END;
