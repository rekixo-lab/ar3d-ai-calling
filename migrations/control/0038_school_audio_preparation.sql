-- Isolated production Control D1; no seed, provider call or client minute debit.
-- One worst-case reservation per reviewed frozen launch. Failed and uncertain
-- jobs remain reserved against the dedicated TTS envelope; never retry a version.
CREATE TABLE IF NOT EXISTS school_audio_preparations (
 tenant_id TEXT NOT NULL, launch_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
 graph_sha256 TEXT NOT NULL CHECK(length(graph_sha256)=64 AND graph_sha256 NOT GLOB '*[^0-9a-f]*'),
 state TEXT NOT NULL DEFAULT 'claimed' CHECK(state IN('claimed','ready','failed','approved','rejected')),
 char_count INTEGER NOT NULL CHECK(char_count BETWEEN 1 AND 2000),
 node_count INTEGER NOT NULL CHECK(node_count BETWEEN 3 AND 5),
 reserved_micros INTEGER NOT NULL CHECK(reserved_micros BETWEEN 1 AND 100000000),
 rate_micros INTEGER NOT NULL CHECK(rate_micros BETWEEN 1 AND 100000),
 funding_reference TEXT NOT NULL CHECK(length(funding_reference) BETWEEN 10 AND 160),
 attempted_nodes INTEGER NOT NULL DEFAULT 0 CHECK(attempted_nodes BETWEEN 0 AND node_count),
 claimed_by TEXT NOT NULL REFERENCES human_users(id),
 claimed_at INTEGER NOT NULL, deadline INTEGER NOT NULL CHECK(deadline=claimed_at+120000),
 manifest_json TEXT, manifest_sha256 TEXT,
 reviewed_by TEXT REFERENCES human_users(id), reviewed_at INTEGER, review_reference TEXT,
 PRIMARY KEY(tenant_id,launch_id), UNIQUE(tenant_id,snapshot_id),
 FOREIGN KEY(tenant_id,launch_id) REFERENCES industry_launch_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,snapshot_id) REFERENCES ai_flow_snapshots(tenant_id,id),
 CHECK(reserved_micros=char_count*rate_micros),
 CHECK((state IN('claimed','failed') AND manifest_json IS NULL AND manifest_sha256 IS NULL) OR
 (state IN('ready','approved','rejected') AND manifest_json IS NOT NULL AND length(manifest_json)<=16384
 AND json_valid(manifest_json) AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*' AND attempted_nodes=node_count)),
 CHECK((state IN('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_reference IS NOT NULL AND length(review_reference) BETWEEN 10 AND 160)
 OR (state NOT IN('approved','rejected') AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reference IS NULL)),
 CHECK(state<>'approved' OR reviewed_by<>claimed_by)
);
CREATE INDEX IF NOT EXISTS idx_school_audio_claimed ON school_audio_preparations(state,deadline);
CREATE TRIGGER IF NOT EXISTS trg_school_audio_insert BEFORE INSERT ON school_audio_preparations
 WHEN NEW.state<>'claimed' OR NEW.attempted_nodes<>0 OR NOT EXISTS(
 SELECT 1 FROM industry_launch_requests r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.launch_id
 AND r.snapshot_id=NEW.snapshot_id AND r.graph_sha256=NEW.graph_sha256 AND r.state='configuration_reviewed' AND r.purpose='school_admission')
 BEGIN SELECT RAISE(ABORT,'invalid School audio claim'); END;
CREATE TRIGGER IF NOT EXISTS trg_school_audio_update BEFORE UPDATE ON school_audio_preparations
 WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.launch_id<>OLD.launch_id OR NEW.snapshot_id<>OLD.snapshot_id
 OR NEW.graph_sha256<>OLD.graph_sha256 OR NEW.char_count<>OLD.char_count OR NEW.node_count<>OLD.node_count
 OR NEW.reserved_micros<>OLD.reserved_micros OR NEW.rate_micros<>OLD.rate_micros OR NEW.funding_reference<>OLD.funding_reference
 OR NEW.claimed_by<>OLD.claimed_by OR NEW.claimed_at<>OLD.claimed_at OR NEW.deadline<>OLD.deadline
 OR NOT ((OLD.state='claimed' AND NEW.state='claimed' AND NEW.attempted_nodes=OLD.attempted_nodes+1)
 OR (OLD.state='claimed' AND NEW.state IN('ready','failed') AND NEW.attempted_nodes=OLD.attempted_nodes)
 OR (OLD.state='ready' AND NEW.state IN('approved','rejected') AND NEW.attempted_nodes=OLD.attempted_nodes
 AND NEW.manifest_json IS OLD.manifest_json AND NEW.manifest_sha256 IS OLD.manifest_sha256))
 BEGIN SELECT RAISE(ABORT,'immutable School audio reservation'); END;
CREATE TRIGGER IF NOT EXISTS trg_school_audio_delete BEFORE DELETE ON school_audio_preparations
 BEGIN SELECT RAISE(ABORT,'immutable School audio reservation'); END;
