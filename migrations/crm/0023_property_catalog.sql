-- Client-owned inventory. Customer preferences and calling permissions remain separate.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS properties (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 property_type TEXT NOT NULL CHECK(property_type IN('plot','flat','house')),
 city TEXT NOT NULL CHECK(length(city) BETWEEN 1 AND 120),
 city_aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(city_aliases_json) AND json_type(city_aliases_json)='array' AND json_array_length(city_aliases_json)<=5),
 locality TEXT NOT NULL DEFAULT '',
 locality_aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(locality_aliases_json) AND json_type(locality_aliases_json)='array' AND json_array_length(locality_aliases_json)<=5),
 address TEXT NOT NULL DEFAULT '',
 map_url TEXT NOT NULL DEFAULT '',
 price_min_inr INTEGER,
 price_max_inr INTEGER,
 price_basis TEXT NOT NULL DEFAULT 'on_request' CHECK(price_basis IN('total','per_sqft','per_sqm','on_request')),
 size_min REAL,
 size_max REAL,
 size_unit TEXT NOT NULL DEFAULT 'sqft' CHECK(size_unit IN('sqft','sqm','sqyd','acre')),
 bhk INTEGER CHECK(bhk IS NULL OR bhk BETWEEN 1 AND 20),
 description TEXT NOT NULL DEFAULT '',
 amenities TEXT NOT NULL DEFAULT '',
 contact_name TEXT NOT NULL DEFAULT '',
 contact_phone TEXT NOT NULL DEFAULT '',
 website_url TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'available' CHECK(status IN('available','paused','sold')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 last_write_id TEXT NOT NULL,
 created_by TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),
 CHECK((price_basis='on_request' AND price_min_inr IS NULL AND price_max_inr IS NULL) OR
  (price_basis!='on_request' AND price_min_inr IS NOT NULL AND price_max_inr IS NOT NULL AND
   typeof(price_min_inr)='integer' AND typeof(price_max_inr)='integer' AND price_min_inr>0 AND price_max_inr>=price_min_inr)),
 CHECK((size_min IS NULL AND size_max IS NULL) OR
  (size_min IS NOT NULL AND size_max IS NOT NULL AND size_min>0 AND size_max>=size_min))
);
CREATE INDEX IF NOT EXISTS idx_properties_tenant_status ON properties(tenant_id,status,updated_at,id);
CREATE TABLE IF NOT EXISTS property_assets (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 property_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('brochure','photo')),
 file_name TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK(content_type IN('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 object_key TEXT NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id),
 CHECK((kind='brochure' AND content_type='application/pdf') OR
  (kind='photo' AND content_type IN('image/jpeg','image/png','image/webp') AND size_bytes<=3145728))
);
CREATE INDEX IF NOT EXISTS idx_property_assets_property ON property_assets(tenant_id,property_id,active,kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_one_brochure ON property_assets(tenant_id,property_id) WHERE kind='brochure' AND active=1;
CREATE TABLE IF NOT EXISTS campaign_property_settings (
 tenant_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 last_write_id TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,campaign_id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES call_campaign_drafts(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS campaign_properties (
 tenant_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 property_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 2),
 PRIMARY KEY(tenant_id,campaign_id,property_id),
 UNIQUE(tenant_id,campaign_id,position),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES campaign_property_settings(tenant_id,campaign_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS property_media_shares (
 tenant_id TEXT NOT NULL,
 token_hash TEXT NOT NULL CHECK(length(token_hash)=64),
 asset_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,token_hash),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES property_assets(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_property_media_expiry ON property_media_shares(tenant_id,expires_at);
