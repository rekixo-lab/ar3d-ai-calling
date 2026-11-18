import pathlib
import sqlite3
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

class TenantSuspensionSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for name in ('0001_init.sql','0002_human_access.sql','0003_ip_login_limits.sql',
                     '0004_super_admin_mfa.sql','0005_mfa_recovery.sql','0006_tenant_lifecycle.sql'):
            self.db.executescript((ROOT/'migrations/control'/name).read_text())
        for id,status in [('a','trial'),('b','active')]:
            self.db.execute("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                            (id,'tenant-'+id,'Demo','starter','shared',status,'now','now'))
    def tearDown(self):self.db.close()
    def test_suspend_stores_previous_state_and_can_restore(self):
        self.db.execute("UPDATE tenants SET status='suspended',suspended_from_status=status WHERE id='a' AND status='trial'")
        self.assertEqual(self.db.execute("SELECT status,suspended_from_status FROM tenants WHERE id='a'").fetchone(),
                         ('suspended','trial'))
        self.db.execute("UPDATE tenants SET status=suspended_from_status,suspended_from_status=NULL WHERE id='a'")
        self.assertEqual(self.db.execute("SELECT status,suspended_from_status FROM tenants WHERE id='a'").fetchone(),
                         ('trial',None))
    def test_resume_cannot_change_prior_subscription_state(self):
        self.db.execute("UPDATE tenants SET status='suspended',suspended_from_status=status WHERE id='b'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tenants SET status='trial' WHERE id='b'")
        self.db.execute("UPDATE tenants SET status='active',suspended_from_status=NULL WHERE id='b'")
        self.assertEqual(self.db.execute("SELECT status FROM tenants WHERE id='b'").fetchone()[0],'active')
    def test_suspend_requires_persisting_previous_status(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE tenants SET status='suspended' WHERE id='a'")
    def test_pragmas_tenant_access_gate_rechecks_status(self):
        self.db.execute("UPDATE tenants SET status='suspended',suspended_from_status=status WHERE id='a'")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM tenants WHERE status IN ('trial','active')").fetchone()[0],1)
if __name__=='__main__':
    unittest.main()
