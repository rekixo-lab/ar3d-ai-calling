-- Queue deliveries are at least once. Claim each two-minute dispatch slot once,
-- independently of the existing voice cron's D1 invocation budget.
CREATE TABLE IF NOT EXISTS whatsapp_dispatch_ticks (
 slot_start_ms INTEGER PRIMARY KEY CHECK(slot_start_ms>=0 AND slot_start_ms%120000=0),
 claimed_at TEXT NOT NULL,
 finished_at TEXT,
 outcome TEXT NOT NULL DEFAULT 'claimed' CHECK(outcome IN('claimed','completed','failed'))
);
