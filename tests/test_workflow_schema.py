import sqlite3
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class WorkflowSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for name in ('0001_init.sql','0002_lead_workflow.sql'):
            self.db.executescript((ROOT/'migrations/crm'/name).read_text())
        for tenant in ('a','b'):
            self.db.execute("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,?,'+919876543210','excel','now','now')",(tenant,tenant,'Example'))
    def tearDown(self):self.db.close()
    def test_default_status_separate_tenant(self):
        self.assertEqual(self.db.execute("SELECT interest_status FROM leads WHERE tenant_id='a'").fetchone()[0],'new')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM leads').fetchone()[0],2)
    def test_bad_status_fails(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE leads SET interest_status='dial_now' WHERE tenant_id='a'")
    def test_cross_tenant_note_reference_blocked(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO lead_notes(tenant_id,id,lead_id,text,actor,created_at) VALUES('a','n1','b','x','actor','now')")
    def test_own_note_supported(self):
        self.db.execute("INSERT INTO lead_notes(tenant_id,id,lead_id,text,actor,created_at) VALUES('a','n1','a','Corner plot','actor','now')")
        self.assertEqual(self.db.execute('SELECT text FROM lead_notes').fetchone()[0],'Corner plot')
    def test_duplicate_existing_csv_mobile_is_no_op(self):
        cur=self.db.execute("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES('a','new','Change name','+919876543210','excel','now','now') ON CONFLICT(tenant_id,mobile_e164) DO NOTHING")
        self.assertEqual(cur.rowcount,0)
        self.assertEqual(self.db.execute("SELECT name FROM leads WHERE tenant_id='a'").fetchone()[0],'Example')
