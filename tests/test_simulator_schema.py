import sqlite3
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class SimulatorSchema(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ['0001_init.sql','0002_lead_workflow.sql','0003_conversation_simulator.sql']:
   self.db.executescript((ROOT/'migrations'/'crm'/name).read_text())
  for tenant in ('a','b'):
   self.db.execute("INSERT INTO agents(tenant_id,id,display_name,language_mode,questions_json,status,created_at,updated_at) VALUES(?,?,'Demo','hi','[\"Question\"]','draft','now','now')",(tenant,'same-agent'))
 def test_cannot_bind_other_tenant_agent(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO conversation_simulations VALUES('a','sim','wrong','owner','{}',1,'now','now','tomorrow')")
 def test_tenant_scoped_simulators_can_share_id(self):
  for tenant in ('a','b'):
   self.db.execute("INSERT INTO conversation_simulations VALUES(?, 'sim', 'same-agent','owner','{}',1,'now','now','tomorrow')",(tenant,))
  self.assertEqual(self.db.execute('SELECT count(*) FROM conversation_simulations').fetchone()[0],2)
  self.db.execute("UPDATE conversation_simulations SET revision=revision+1 WHERE tenant_id='a' AND id='sim' AND revision=1")
  self.assertEqual(self.db.execute("SELECT revision FROM conversation_simulations WHERE tenant_id='b'").fetchone()[0],1)
 def test_invalid_revision_and_state_length_rejected(self):
  for state,revision in [('',1),('{}',0)]:
   with self.assertRaises(sqlite3.IntegrityError):
    self.db.execute("INSERT INTO conversation_simulations VALUES('a', ?, 'same-agent','owner',?,?,'now','now','tomorrow')",('xx'+str(revision),state,revision))
if __name__=='__main__':unittest.main()
