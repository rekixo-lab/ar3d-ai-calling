import sqlite3
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

class HumanSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript((ROOT/'migrations/control/0001_init.sql').read_text())
        self.db.executescript((ROOT/'migrations/control/0002_human_access.sql').read_text())
        self.db.execute("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,created_at,updated_at) VALUES('tenant-a','tenant-a','Tenant A','starter','shared','now','now')")
        self.db.execute("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,created_at,updated_at) VALUES('tenant-b','tenant-b','Tenant B','starter','shared','now','now')")
        self.db.execute("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES('user-a','a@example.com',?, ?, 240000,'now','now')",('a'*32,'b'*64))
    def tearDown(self):
        self.db.close()
    def test_membership_is_project_scoped_and_two_tenants_supported(self):
        self.db.execute("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES('tenant-a','user-a','client_admin','now')")
        self.db.execute("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES('tenant-b','user-a','viewer','now')")
        rows=self.db.execute('SELECT tenant_id,role FROM tenant_memberships ORDER BY tenant_id').fetchall()
        self.assertEqual(rows,[('tenant-a','client_admin'),('tenant-b','viewer')])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES('missing','user-a','client_admin','now')")
    def test_bootstrap_claim_is_single_use(self):
        self.db.execute("INSERT INTO human_bootstrap_claim VALUES(1,'now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_bootstrap_claim VALUES(1,'later')")
    def test_invitation_role_is_constrained(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_invitations(token_hash,tenant_id,email,role,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)",('c'*64,'tenant-a','b@example.com','super_admin',100,'user-a','now'))
    def test_session_fails_on_unknown_user(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",('d'*64,'not-real','now',100))
