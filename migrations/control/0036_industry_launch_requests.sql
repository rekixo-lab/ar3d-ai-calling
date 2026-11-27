-- Production multi-industry launch review, additive only.
-- A reviewed request is not a telephony authorization, job or credit hold.
CREATE TABLE IF NOT EXISTS industry_launch_requests (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 purpose TEXT NOT NULL CHECK(purpose='school_admission'),
 requested_by TEXT NOT NULL REFERENCES human_users(id),
 requested_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','configuration_reviewed','rejected','withdrawn')),
 decided_by TEXT REFERENCES human_users(id),
 decided_at TEXT,
 review_reference TEXT,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,snapshot_id),
 FOREIGN KEY(tenant_id,snapshot_id) REFERENCES ai_flow_snapshots(tenant_id,id),
 CHECK((state='requested' AND decided_by IS NULL AND decided_at IS NULL AND review_reference IS NULL) OR
       (state<>'requested' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND review_reference IS NOT NULL AND length(review_reference) BETWEEN 3 AND 300)),
 CHECK(state NOT IN ('configuration_reviewed','rejected') OR requested_by<>decided_by)
);
CREATE INDEX IF NOT EXISTS idx_industry_launch_requests_tenant ON industry_launch_requests(tenant_id,requested_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_industry_launch_request_guard BEFORE UPDATE ON industry_launch_requests
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.snapshot_id<>OLD.snapshot_id OR
 NEW.graph_sha256<>OLD.graph_sha256 OR NEW.purpose<>OLD.purpose OR NEW.requested_by<>OLD.requested_by OR
 NEW.requested_at<>OLD.requested_at OR OLD.state<>'requested' OR NEW.state='requested'
 BEGIN SELECT RAISE(ABORT,'immutable industry launch request'); END;
CREATE TRIGGER IF NOT EXISTS trg_industry_launch_request_no_delete BEFORE DELETE ON industry_launch_requests
 BEGIN SELECT RAISE(ABORT,'immutable industry launch request'); END;
