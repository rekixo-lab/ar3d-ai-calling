import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class OptOutSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for f in ('0001_init.sql','0002_lead_workflow.sql','0003_conversation_simulator.sql','0004_lead_opt_out.sql'):
            self.db.executescript((ROOT/'migrations/crm'/f).read_text())
        for tenant,lead in [('tenantA','leadA'),('tenantB','leadB')]:
            self.db.execute("""INSERT INTO leads (tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
              VALUES (?,?,'Demo','+919876543210','excel','now','now')""",(tenant,lead))
    def tearDown(self):
        self.db.close()

    def opt_out(self,tenant,lead):
        self.db.execute("""INSERT INTO lead_opt_out_events
          (tenant_id,id,lead_id,source,actor,created_at)
          VALUES (?,? ,?,'customer_request','agent1','now')""",(tenant,'event-'+lead,lead))
        self.db.execute("""UPDATE leads SET consent_status='denied',dnd_status='blocked'
          WHERE tenant_id=? AND id=?""",(tenant,lead))

    def test_own_tenant_opt_out_is_tracked(self):
        self.opt_out('tenantA','leadA')
        self.assertEqual(self.db.execute("""SELECT consent_status,dnd_status FROM leads
          WHERE tenant_id='tenantA'""").fetchone(),('denied','blocked'))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM lead_opt_out_events WHERE tenant_id='tenantB'").fetchone()[0],0)

    def test_cross_tenant_event_reference_fails(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO lead_opt_out_events
              (tenant_id,id,lead_id,source,actor,created_at)
              VALUES ('tenantA','event1','leadB','other','admin','now')""")

    def test_cannot_regrant_after_optout(self):
        self.opt_out('tenantA','leadA')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""UPDATE leads SET consent_status='unknown',dnd_status='unknown'
              WHERE tenant_id='tenantA' AND id='leadA'""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""UPDATE leads SET consent_status='granted',consent_proof='doc',
              consent_at='now',dnd_status='allowed' WHERE tenant_id='tenantA' AND id='leadA'""")

    def test_duplicate_import_does_not_reset_optout(self):
        self.opt_out('tenantA','leadA')
        self.db.execute("""INSERT INTO leads
          (tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
          VALUES ('tenantA','another','Overwrite','+919876543210','excel','now','now')
          ON CONFLICT(tenant_id,mobile_e164) DO NOTHING""")
        self.assertEqual(self.db.execute("""SELECT consent_status,dnd_status FROM leads
           WHERE tenant_id='tenantA'""").fetchone(),('denied','blocked'))

    def test_only_known_sources_and_short_reasons(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO lead_opt_out_events
              (tenant_id,id,lead_id,source,actor,created_at)
              VALUES ('tenantA','invalid','leadA','grant','admin','now')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO lead_opt_out_events
              (tenant_id,id,lead_id,source,reason,actor,created_at)
              VALUES ('tenantA','badnote','leadA','other',?,'admin','now')""",('x'*501,))

if __name__=='__main__':
    unittest.main()
