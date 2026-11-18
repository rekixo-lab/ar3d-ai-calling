import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class AgentSafetySchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for file in ('0001_init.sql','0002_lead_workflow.sql','0003_conversation_simulator.sql',
                     '0004_lead_opt_out.sql','0005_consent_evidence.sql',
                     '0006_campaign_drafts.sql','0007_agent_safety.sql'):
            self.db.executescript((ROOT/'migrations/crm'/file).read_text())
        self.db.execute("INSERT INTO agents(tenant_id,id,display_name,language_mode,questions_json,created_at,updated_at) VALUES('t1','a1','Demo','hi-en','[\"Hello?\"]','now','now')")
    def tearDown(self):self.db.close()
    def test_agent_cannot_be_activated_with_update(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE agents SET status='active' WHERE tenant_id='t1' AND id='a1'")
    def test_agent_cannot_be_inserted_active(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO agents(tenant_id,id,display_name,status,created_at,updated_at) VALUES('t1','a2','Demo','active','now','now')")
    def test_draft_can_be_paused_and_resumed_safely(self):
        self.db.execute("UPDATE agents SET status='paused' WHERE tenant_id='t1' AND id='a1'")
        self.db.execute("UPDATE agents SET status='draft' WHERE tenant_id='t1' AND id='a1'")
        self.assertEqual(self.db.execute("SELECT status FROM agents").fetchone()[0],'draft')
    def test_real_calls_still_blocked(self):
        self.db.execute("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES('t1','l1','Demo','+919876543210','excel','now','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO calls(tenant_id,id,lead_id,agent_id,created_at) VALUES('t1','c1','l1','a1','now')")
