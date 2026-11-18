-- AR3D AI Calling Control D1 only after 0006. No real provider is attached.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS provider_event_inbox (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider='internal_test'),
  event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(event_kind IN
    ('call.initiated','call.ringing','call.connected','call.completed','call.failed','consent.opted_out')),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  status TEXT NOT NULL DEFAULT 'quarantined' CHECK(status='quarantined'),
  received_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,provider,event_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_event_inbox_tenant
  ON provider_event_inbox(tenant_id,received_at);
