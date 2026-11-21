-- AR3D AI Calling Control D1 only. Company change requests contain no
-- customer/mobile/transcript data and never modify published AI facts.
PRAGMA foreign_keys=ON;
CREATE TABLE company_change_requests (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 id TEXT NOT NULL,
 message TEXT NOT NULL CHECK(length(message) BETWEEN 15 AND 1200),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','handled','dismissed')),
 created_by TEXT NOT NULL REFERENCES human_users(id),
 created_at TEXT NOT NULL,
 handled_by TEXT REFERENCES human_users(id),
 handled_at TEXT,
 resolution_note TEXT CHECK(resolution_note IS NULL OR length(resolution_note)<=500),
 PRIMARY KEY(tenant_id,id),
 CHECK((status='pending' AND handled_by IS NULL AND handled_at IS NULL) OR
       (status!='pending' AND handled_by IS NOT NULL AND handled_at IS NOT NULL))
);
CREATE INDEX idx_company_change_requests_queue ON company_change_requests(tenant_id,status,created_at);
CREATE TRIGGER company_change_requests_immutable BEFORE UPDATE OF
 tenant_id,id,message,created_by,created_at ON company_change_requests
 BEGIN SELECT RAISE(ABORT,'company change request identity immutable'); END;
CREATE TRIGGER company_change_requests_no_reopen BEFORE UPDATE OF status ON company_change_requests
 WHEN OLD.status!='pending' OR NEW.status='pending'
 BEGIN SELECT RAISE(ABORT,'company change request resolution immutable'); END;
CREATE TRIGGER company_change_requests_no_delete BEFORE DELETE ON company_change_requests
 BEGIN SELECT RAISE(ABORT,'company change request history immutable'); END;
