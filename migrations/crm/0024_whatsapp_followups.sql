-- WhatsApp permissions and delivery state are independent of voice permissions.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS whatsapp_rules (
 tenant_id TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 enabled_at TEXT,
 first_delay_minutes INTEGER NOT NULL DEFAULT 10 CHECK(first_delay_minutes BETWEEN 5 AND 1440),
 second_enabled INTEGER NOT NULL DEFAULT 0 CHECK(second_enabled IN(0,1)),
 second_delay_hours INTEGER NOT NULL DEFAULT 48 CHECK(second_delay_hours BETWEEN 24 AND 168),
 visit_reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK(visit_reminder_enabled IN(0,1)),
 template_name TEXT NOT NULL DEFAULT '',
 template_language TEXT NOT NULL DEFAULT 'hi',
 followup_template_name TEXT NOT NULL DEFAULT '',
 followup_template_language TEXT NOT NULL DEFAULT 'hi',
 visit_template_name TEXT NOT NULL DEFAULT '',
 visit_template_language TEXT NOT NULL DEFAULT 'hi',
 daily_limit INTEGER NOT NULL DEFAULT 100 CHECK(daily_limit BETWEEN 1 AND 10000),
 cursor_at TEXT,
 cursor_job_id TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE IF NOT EXISTS whatsapp_permissions (
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('granted','revoked')),
 source TEXT NOT NULL CHECK(source IN('website_form','ad_form','existing_crm','customer_message','other')),
 reference TEXT NOT NULL CHECK(length(reference) BETWEEN 4 AND 500),
 captured_at TEXT NOT NULL,
 actor TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,lead_id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS whatsapp_threads (
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN(0,1)),
 last_inbound_at TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,lead_id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS whatsapp_messages (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 source_key TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 campaign_id TEXT,
 property_id TEXT,
 visit_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN('property_details','followup','visit_reminder','reply')),
 due_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('scheduled','pending_setup','submitted','delivered','read','replied','failed','cancelled','unknown','review_required')),
 reason TEXT NOT NULL DEFAULT '',
 template_name TEXT NOT NULL DEFAULT '',
 template_language TEXT NOT NULL DEFAULT 'hi',
 provider_message_id TEXT,
 source_at TEXT NOT NULL,
 payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 submitted_at TEXT,
 delivered_at TEXT,
 read_at TEXT,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,source_key),
 UNIQUE(tenant_id,provider_message_id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES call_campaign_drafts(tenant_id,id),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id),
 FOREIGN KEY(tenant_id,visit_id) REFERENCES site_visits(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_due ON whatsapp_messages(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead ON whatsapp_messages(tenant_id,lead_id,created_at);
CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 text TEXT NOT NULL,
 message_type TEXT NOT NULL,
 received_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_lead ON whatsapp_inbound_messages(tenant_id,lead_id,received_at);
CREATE TABLE IF NOT EXISTS whatsapp_event_receipts (
 tenant_id TEXT NOT NULL,
 event_key TEXT NOT NULL,
 received_at TEXT NOT NULL,
 payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
 processed_at TEXT,
 cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),
 PRIMARY KEY(tenant_id,event_key)
);
