CREATE TABLE company_profile_versions (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 created_by TEXT NOT NULL REFERENCES human_users(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,revision)
);
CREATE TRIGGER company_profile_versions_no_update BEFORE UPDATE ON company_profile_versions
BEGIN SELECT RAISE(ABORT,'company profile history is immutable'); END;
CREATE TRIGGER company_profile_versions_no_delete BEFORE DELETE ON company_profile_versions
BEGIN SELECT RAISE(ABORT,'company profile history is immutable'); END;
