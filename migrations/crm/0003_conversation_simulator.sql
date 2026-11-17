-- Isolated, short-lived simulator only. No dial attempts, real calls, or lead-consent writes.
-- Apply after 0002_lead_workflow.sql on NEW AI Calling shared/dedicated D1 databases only.
CREATE TABLE IF NOT EXISTS conversation_simulations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK(length(state_json) BETWEEN 2 AND 120000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversation_simulations_expiry ON conversation_simulations(expires_at);
CREATE INDEX IF NOT EXISTS idx_conversation_simulations_tenant_agent ON conversation_simulations(tenant_id,agent_id,created_at);
