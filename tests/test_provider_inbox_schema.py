import pathlib
import sqlite3
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class QuarantinedInboxSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for sql in ('0001_init.sql','0002_human_access.sql','0003_ip_login_limits.sql','0004_super_admin_mfa.sql',
                    '0005_mfa_recovery.sql','0006_tenant_lifecycle.sql','0007_provider_inbox.sql'):
            self.db.executescript((ROOT/'migrations/control'/sql).read_text())
        for tid in ('t1','t2'):
            self.db.execute("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                            (tid,'tenant-'+tid,'Sample','starter','shared','now','now'))
    def tearDown(self):self.db.close()
    def insert(self,tid,event='id',provider='internal_test',status='quarantined'):
        self.db.execute("INSERT INTO provider_event_inbox(tenant_id,provider,event_id,event_kind,payload_digest,status,received_at) VALUES (?,?,?,'call.ringing',?,?,?)",
                        (tid,provider,event,'a'*64,status,'now'))
    def test_idempotency_key_is_per_tenant_and_provider(self):
        self.insert('t1')
        with self.assertRaises(sqlite3.IntegrityError):self.insert('t1')
        self.insert('t2')
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM provider_event_inbox").fetchone()[0],2)
    def test_only_internal_test_provider_and_quarantined_events_permitted(self):
        with self.assertRaises(sqlite3.IntegrityError):self.insert('t1',provider='twilio')
        with self.assertRaises(sqlite3.IntegrityError):self.insert('t1',status='processed')
        self.insert('t1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE provider_event_inbox SET status='processed'")
    def test_foreign_tenant_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):self.insert('not-a-tenant')
if __name__=='__main__':
    unittest.main()
