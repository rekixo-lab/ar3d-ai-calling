-- Platform-wide calling capacity, set by a current-MFA Super Admin. Matches the
-- Plivo concurrency and Sarvam speech-to-text limits bought for the account.
-- It is not a funding grant: client minutes and provider ceilings still apply.
CREATE TABLE IF NOT EXISTS calling_dispatch_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 max_concurrent_calls INTEGER NOT NULL CHECK(max_concurrent_calls BETWEEN 1 AND 2000),
 max_calls_per_company INTEGER NOT NULL CHECK(max_calls_per_company BETWEEN 1 AND 500),
 updated_by TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL
);
-- Per-company consent mode. 'client_declared' lets a Client Admin declare the
-- consent source when starting a campaign; 'reviewed' keeps per-customer
-- Super Admin clearance. Opt-out, DND-blocked and denied customers stay blocked.
CREATE TABLE IF NOT EXISTS calling_company_settings (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 consent_mode TEXT NOT NULL CHECK(consent_mode IN('reviewed','client_declared')),
 updated_by TEXT NOT NULL REFERENCES human_users(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL
);
-- Short provider back-off: a Sarvam 429 pauses NEW dispatch briefly so calls
-- already in progress keep their speech-recognition capacity.
CREATE TABLE IF NOT EXISTS calling_capacity_signals (
 provider TEXT PRIMARY KEY CHECK(provider IN('sarvam','plivo')),
 throttled_until INTEGER NOT NULL CHECK(throttled_until>=0),
 updated_at TEXT NOT NULL
);
