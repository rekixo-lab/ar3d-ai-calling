import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

def db(schema):
    conn=sqlite3.connect(':memory:')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.executescript((ROOT/'migrations'/schema/'0001_init.sql').read_text())
    return conn

class SchemaTests(unittest.TestCase):
    def test_control_database_supports_shared_and_dedicated(self):
        con=db('control')
        con.execute('INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                    ('t1','builder-one','Builder One','starter','shared','now','now'))
        con.execute('INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                    ('t2','builder-two','Builder Two','enterprise','dedicated','now','now'))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute('INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                        ('t3','builder-one','duplicate','starter','shared','now','now'))
        con.close()

    def test_shared_crm_same_number_is_allowed_for_separate_tenants(self):
        con=db('crm')
        for tid in ['t1','t2']:
            con.execute('''INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?)''',(tid,'l1','Lead','+919876543210','excel','now','now'))
        self.assertEqual(con.execute('SELECT COUNT(*) FROM leads').fetchone()[0],2)
        for tid in ['t1','t2']:
            self.assertEqual(con.execute('SELECT COUNT(*) FROM leads WHERE tenant_id=?',(tid,)).fetchone()[0],1)
        con.close()

    def test_cross_tenant_call_foreign_key_is_rejected(self):
        con=db('crm')
        con.execute('INSERT INTO leads(tenant_id,id,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                    ('tenant-a','lead-a','+919876543210','excel','now','now'))
        con.execute('INSERT INTO agents(tenant_id,id,display_name,created_at,updated_at) VALUES(?,?,?,?,?)',
                    ('tenant-b','agent-b','AI Agent','now','now'))
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute('INSERT INTO calls(tenant_id,id,lead_id,agent_id,created_at) VALUES(?,?,?,?,?)',
                        ('tenant-b','call-one','lead-a','agent-b','now'))
        con.close()

    def test_granted_consent_requires_evidence(self):
        con=db('crm')
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute('''INSERT INTO leads(tenant_id,id,mobile_e164,source_type,consent_status,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?)''',('t','l','+919876543210','excel','granted','now','now'))
        con.close()

if __name__=='__main__': unittest.main()
