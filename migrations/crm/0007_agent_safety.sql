-- AR3D AI Calling CRM schema v7. Never run on Platform/Engine D1.
-- Until telecom/legal safety integrations are verified, no agent can be live.
PRAGMA foreign_keys=ON;
CREATE TRIGGER IF NOT EXISTS trg_agents_block_active_insert
BEFORE INSERT ON agents WHEN NEW.status='active'
BEGIN SELECT RAISE(ABORT,'agent activation disabled pending telecom compliance'); END;
CREATE TRIGGER IF NOT EXISTS trg_agents_block_active_update
BEFORE UPDATE OF status ON agents WHEN NEW.status='active'
BEGIN SELECT RAISE(ABORT,'agent activation disabled pending telecom compliance'); END;
