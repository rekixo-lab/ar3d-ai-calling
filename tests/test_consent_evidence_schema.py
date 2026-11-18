import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class ConsentEvidenceSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for f in ('0001_init.sql','0002_lead_workflow.sql','0003_conversation_simulator.sql','0004_lead_opt_out.sql','0005_consent_evidence.sql'):
            self.db.executescript((ROOT/'migrations/crm'/f).read_text())
        for tenant,lead in [('companyA','leadA'),('companyB','leadB')]:
            self.db.execute("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES (?,?,'Sample','+919876543210','excel','now','now')",(tenant,lead))
    def tearDown(self):
        self.db.close()
    def evidence(self,tenant,lead):
        self.db.execute("""INSERT INTO lead_consent_evidence
            (tenant_id,id,lead_id,source,purpose,reference,captured_at,received_at,submitted_by)
            VALUES (?,? ,?,'website_form','site_visit','form-1234','2026-11-18','2026-11-18','user')""",
            (tenant,'id-'+lead,lead))
    def test_pending_is_not_consent(self):
        self.evidence('companyA','leadA')
        self.assertEqual(self.db.execute("SELECT review_status FROM lead_consent_evidence").fetchone()[0],'pending')
        self.assertEqual(self.db.execute("SELECT consent_status,dnd_status FROM leads WHERE tenant_id='companyA'").fetchone(),('unknown','unknown'))
    def test_cross_tenant_reference_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.evidence('companyA','leadB')
    def test_cannot_grant_consent_or_dnd_through_sql(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE leads SET consent_status='granted',consent_proof='fake',consent_at='2026-11-18' WHERE tenant_id='companyA'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE leads SET dnd_status='allowed' WHERE tenant_id='companyB'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO leads(tenant_id,id,mobile_e164,source_type,consent_status,consent_proof,consent_at,dnd_status,created_at,updated_at)
                VALUES ('companyA','new','+919123451234','other','granted','fake','now','allowed','now','now')""")
    def test_opt_out_is_still_possible(self):
        self.db.execute("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at) VALUES('companyA','stop','leadA','customer_request','user','now')")
        self.db.execute("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id='companyA' AND id='leadA'")
        self.assertEqual(self.db.execute("SELECT dnd_status FROM leads WHERE tenant_id='companyA'").fetchone()[0],'blocked')
    def test_evidence_source_and_purpose_restricted(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO lead_consent_evidence
              (tenant_id,id,lead_id,source,purpose,reference,captured_at,received_at,submitted_by)
              VALUES ('companyA','e1','leadA','auto_verified','marketing','form-1234','now','now','user')""")
