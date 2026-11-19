import pathlib
import sqlite3
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

class BossQualificationSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for name in ('0001_init.sql','0002_lead_workflow.sql','0003_conversation_simulator.sql',
                     '0004_lead_opt_out.sql','0005_consent_evidence.sql','0006_campaign_drafts.sql',
                     '0007_agent_safety.sql','0008_customer_qualification.sql'):
            self.db.executescript((ROOT/'migrations/crm'/name).read_text())
    def tearDown(self):self.db.close()
    def lead(self,ident='l1',segment='unclassified'):
        self.db.execute("""INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,
                          customer_segment,created_at,updated_at)
                          VALUES('t1',?,'Demo','+919876543210','excel',?,'now','now')""",
                        (ident,segment))
    def test_default_segment_and_no_call_permission(self):
        self.db.execute("""INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
                         VALUES('t1','l1','Example','+919876543210','excel','now','now')""")
        row=self.db.execute("SELECT customer_segment,consent_status,dnd_status FROM leads").fetchone()
        self.assertEqual(row,('unclassified','unknown','unknown'))
    def test_qualifications_do_not_override_consent_or_dnd_safety(self):
        self.lead(segment='prior_inquiry')
        self.db.execute("UPDATE leads SET customer_segment='unknown_contact',plot_size_preference='30x40 ft',visit_date_preference='2026-12-01'")
        self.assertEqual(self.db.execute("SELECT consent_status,dnd_status FROM leads").fetchone(),('unknown','unknown'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE leads SET consent_status='granted',dnd_status='allowed'")
    def test_reject_unapproved_categories(self):
        with self.assertRaises(sqlite3.IntegrityError):self.lead(segment='approved_to_call')
    def test_call_trigger_still_blocks_real_calls(self):
        self.lead()
        self.db.execute("INSERT INTO agents(tenant_id,id,display_name,created_at,updated_at) VALUES('t1','a1','Draft','now','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO calls(tenant_id,id,lead_id,agent_id,created_at) VALUES('t1','c1','l1','a1','now')")
