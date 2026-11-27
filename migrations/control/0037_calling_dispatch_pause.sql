-- Additive isolated production Control D1. No seed, provider call or credit write.
-- The empty journal preserves prior calling behavior. Only explicit current-MFA
-- operator transitions append events; resume never grants funding or consent.
CREATE TABLE IF NOT EXISTS calling_dispatch_pause_events (
 revision INTEGER PRIMARY KEY CHECK(revision>=1),
 paused INTEGER NOT NULL CHECK(paused IN(0,1)),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 160),
 actor TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_dispatch_pause_sequence BEFORE INSERT ON calling_dispatch_pause_events
 WHEN NEW.revision<>COALESCE((SELECT MAX(revision) FROM calling_dispatch_pause_events),0)+1
 OR NEW.paused=COALESCE((SELECT paused FROM calling_dispatch_pause_events ORDER BY revision DESC LIMIT 1),0)
 BEGIN SELECT RAISE(ABORT,'invalid dispatch pause transition'); END;
CREATE TRIGGER IF NOT EXISTS trg_dispatch_pause_no_update BEFORE UPDATE ON calling_dispatch_pause_events
 BEGIN SELECT RAISE(ABORT,'immutable dispatch pause event'); END;
CREATE TRIGGER IF NOT EXISTS trg_dispatch_pause_no_delete BEFORE DELETE ON calling_dispatch_pause_events
 BEGIN SELECT RAISE(ABORT,'immutable dispatch pause event'); END;
