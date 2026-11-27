-- Phase 2B: versioned frozen SIMULATION snapshots only, never telecom publication.
-- Apply ONLY to isolated ar3d-calling-control D1.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ai_flow_snapshots (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 flow_id TEXT NOT NULL,
 source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 template_id TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json)='object' AND length(config_json) BETWEEN 2 AND 8000),
 graph_json TEXT NOT NULL CHECK(json_valid(graph_json) AND json_type(graph_json)='object' AND length(graph_json) BETWEEN 2 AND 16000),
 graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 compiler_version INTEGER NOT NULL CHECK(compiler_version=1),
 status TEXT NOT NULL DEFAULT 'simulation_only' CHECK(status='simulation_only'),
 created_by TEXT NOT NULL REFERENCES human_users(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,flow_id,source_revision),
 FOREIGN KEY(tenant_id,flow_id) REFERENCES ai_flow_definitions(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_ai_flow_snapshots_tenant_flow ON ai_flow_snapshots(tenant_id,flow_id,source_revision DESC);
CREATE TRIGGER IF NOT EXISTS trg_ai_flow_snapshot_immutable BEFORE UPDATE ON ai_flow_snapshots
BEGIN SELECT RAISE(ABORT,'simulation snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_flow_snapshot_no_delete BEFORE DELETE ON ai_flow_snapshots
BEGIN SELECT RAISE(ABORT,'simulation snapshot history cannot be deleted without reviewed retention migration'); END;
CREATE TABLE IF NOT EXISTS ai_flow_preview_reviews (
 tenant_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN('simulation_reviewed','simulation_rejected')),
 review_note TEXT NOT NULL CHECK(length(review_note) BETWEEN 3 AND 300),
 reviewed_by TEXT NOT NULL REFERENCES human_users(id),
 reviewed_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,snapshot_id),
 FOREIGN KEY(tenant_id,snapshot_id) REFERENCES ai_flow_snapshots(tenant_id,id)
);
CREATE TRIGGER IF NOT EXISTS trg_ai_flow_review_immutable BEFORE UPDATE ON ai_flow_preview_reviews
BEGIN SELECT RAISE(ABORT,'simulation review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_ai_flow_review_no_delete BEFORE DELETE ON ai_flow_preview_reviews
BEGIN SELECT RAISE(ABORT,'simulation review history cannot be deleted without reviewed retention migration'); END;
