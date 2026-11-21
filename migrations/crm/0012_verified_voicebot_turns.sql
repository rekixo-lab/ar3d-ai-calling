-- Isolated Calling CRM only: temporary Exotel per-turn customer answers.
-- Provider identity is checked against a pre-registered Calling job before write.
-- Final review remains immutable and human-approved; no consent/visit/call update.
PRAGMA foreign_keys=ON;
CREATE TABLE voicebot_verified_turns (
 tenant_id TEXT NOT NULL,
 call_sid TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 100),
 kind TEXT NOT NULL CHECK(kind IN ('completed','inprogress','session_end')),
 answer_text TEXT NOT NULL CHECK(length(answer_text)<=220),
 possible_opt_out INTEGER NOT NULL DEFAULT 0 CHECK(possible_opt_out IN(0,1)),
 received_at TEXT NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>0),
 PRIMARY KEY(tenant_id,call_sid,event_id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE INDEX idx_voicebot_turn_call ON voicebot_verified_turns(tenant_id,call_sid,received_at);
CREATE INDEX idx_voicebot_turn_expiry ON voicebot_verified_turns(expires_at);
CREATE TRIGGER voicebot_turn_immutable BEFORE UPDATE ON voicebot_verified_turns
 BEGIN SELECT RAISE(ABORT,'verified voicebot turn is immutable'); END;
