-- AR3D AI Calling Control D1 only, after 0005. Never apply to other AR3D DBs.
-- Preserve previous access state without treating resumption as a payment event.
PRAGMA foreign_keys=ON;
ALTER TABLE tenants ADD COLUMN suspended_from_status TEXT
 CHECK(suspended_from_status IS NULL OR suspended_from_status IN ('trial','active'));
CREATE TRIGGER IF NOT EXISTS trg_tenant_resume_integrity
BEFORE UPDATE OF status ON tenants
WHEN OLD.status='suspended' AND NEW.status IN ('trial','active')
 AND (OLD.suspended_from_status IS NULL OR NEW.status<>OLD.suspended_from_status)
BEGIN
  SELECT RAISE(ABORT,'tenant resume requires the recorded previous state');
END;
CREATE TRIGGER IF NOT EXISTS trg_tenant_suspend_integrity
BEFORE UPDATE OF status ON tenants
WHEN NEW.status='suspended' AND OLD.status IN ('trial','active')
 AND (NEW.suspended_from_status IS NULL OR NEW.suspended_from_status<>OLD.status)
BEGIN
  SELECT RAISE(ABORT,'tenant suspension must preserve the prior state');
END;
