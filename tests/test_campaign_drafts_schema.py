import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
class CampaignDraftSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for f in ['0001_init.sql','0002_lead_workflow.sql','0003_conversation_simulator.sql','0004_lead_opt_out.sql','0005_consent_evidence.sql','0006_campaign_drafts.sql']:
            self.db.executescript((ROOT/'migrations/crm'/f).read_text())
        for tid in ('company-a','company-b'):
            self.db.execute("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES (?,?,'Demo','+919876543210','excel','now','now')",(tid,'lead-'+tid))
            self.db.execute("INSERT INTO agents(tenant_id,id,display_name,created_at,updated_at) VALUES (?,?,'Demo','now','now')",(tid,'agent-'+tid))
            self.db.execute("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,created_by,created_at,updated_at) VALUES (?,?,'Demo','hi-en','site_visit','user','now','now')",(tid,'campaign-'+tid))
    def tearDown(self):self.db.close()
    def test_draft_only_disallows_activation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE call_campaign_drafts SET status='active'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,created_by,created_at,updated_at,status) VALUES('company-a','bad','Demo','hi','site_visit','user','now','now','active')")
    def test_tenant_isolation_in_candidate_foreign_keys(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO call_campaign_candidates VALUES ('company-a','campaign-company-a','lead-company-b','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO call_campaign_candidates VALUES ('company-a','campaign-company-b','lead-company-a','now')")
        self.db.execute("INSERT INTO call_campaign_candidates VALUES ('company-a','campaign-company-a','lead-company-a','now')")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM call_campaign_candidates").fetchone()[0],1)
    def test_call_records_are_disabled_even_for_valid_lead_and_agent(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO calls(tenant_id,id,lead_id,agent_id,created_at) VALUES ('company-a','x','lead-company-a','agent-company-a','now')")
    def test_evidence_and_opt_out_are_still_denied_by_default(self):
        self.assertEqual(self.db.execute("SELECT consent_status,dnd_status FROM leads WHERE tenant_id='company-a'").fetchone(),('unknown','unknown'))
        self.db.execute("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at) VALUES ('company-a','opt','lead-company-a','customer_request','user','now')")
        self.db.execute("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id='company-a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE leads SET dnd_status='allowed' WHERE tenant_id='company-a'")
