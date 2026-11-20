"""Validate isolated Control D1 operator Call Details audit, not a customer dialer."""
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class OperatorCallStatusSchemaTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        for f in sorted((ROOT/'migrations/control').glob('*.sql')):
            self.db.executescript(f.read_text())
        self.uid='123e4567-e89b-42d3-a456-426614174000'
        self.at='2026-11-20T10:00:00.000Z'
        self.call_id='e4ee8ca8-e8f2-422c-82c6-68c51143fc00'
        self.db.execute(
            """INSERT INTO human_users(id,email,password_salt,password_hash,
             password_iterations,global_role,created_at,updated_at)
             VALUES(?,'test@example.com',?,?,300000,'super_admin',?,?)""",
            (self.uid,'a'*32,'b'*64,self.at,self.at))
        self.db.execute(
            """INSERT INTO exotel_operator_test_calls
            (id,actor_user_id,rate_slot,provider_call_sid,state,created_at,updated_at)
            VALUES(?,?,?,'CAabcdef01234567890000000000000000','submitted',?,?)""",
            (self.call_id,self.uid,'29914800',self.at,self.at))

    def tearDown(self):
        self.db.close()

    def insert_check(self,id,slot):
        self.db.execute(
            """INSERT INTO exotel_operator_status_checks
            (id,call_request_id,actor_user_id,check_slot,state,created_at)
            VALUES(?,?,?,?,'reserved',?)""",
            (id,self.call_id,self.uid,slot,self.at))

    def test_reserved_verified_terminal_evidence_cannot_be_rewritten_or_deleted(self):
        id='c0d77987-7b5b-4d3d-87e7-f447a9233f50'
        self.insert_check(id,'5982960')
        self.db.execute(
            """UPDATE exotel_operator_status_checks
            SET state='verified', provider_status='completed',
            duration_seconds=71, finished_at=?
            WHERE id=?""",(self.at,id))
        for sql,params in [
            ("UPDATE exotel_operator_status_checks SET provider_status='busy' WHERE id=?",(id,)),
            ("UPDATE exotel_operator_status_checks SET actor_user_id='different' WHERE id=?",(id,)),
            ("DELETE FROM exotel_operator_status_checks WHERE id=?",(id,)),
        ]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql,params)
        self.assertEqual(self.db.execute(
            'SELECT provider_status FROM exotel_operator_status_checks WHERE id=?',
            (id,)).fetchone()[0],'completed')

    def test_unique_five_minute_slot_and_bounded_provider_status(self):
        id='c0d77987-7b5b-4d3d-87e7-f447a9233f50'
        self.insert_check(id,'5982960')
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_check('c0d77987-7b5b-4d3d-87e7-f447a9233f51','5982960')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE exotel_operator_status_checks
                SET state='verified', provider_status='invalid',
                duration_seconds=70,finished_at=? WHERE id=?""",
                (self.at,id))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE exotel_operator_status_checks
                SET state='verified', provider_status='completed',
                duration_seconds=200000,finished_at=? WHERE id=?""",
                (self.at,id))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "DELETE FROM exotel_operator_test_calls WHERE id=?",(self.call_id,))

    def test_no_crm_customer_or_transcript_tables_created(self):
        tables={r[0] for r in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn('exotel_operator_status_checks',tables)
        for name in ['leads','calls','voicebot_qualification_reviews']:
            self.assertNotIn(name,tables)

if __name__=='__main__':
    unittest.main()
