"""Isolated Control D1 self-test audit schema; cannot be used as CRM dialer."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class OperatorSelfTestSchemaTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for file in sorted((ROOT / "migrations/control").glob("*.sql")):
            self.db.executescript(file.read_text())

    def tearDown(self):
        self.db.close()

    def test_operator_attempts_are_audited_and_immutable(self):
        uid = "123e4567-e89b-42d3-a456-426614174000"
        at = "2026-11-20T10:00:00.000Z"
        self.db.execute(
            """INSERT INTO human_users(id,email,password_salt,password_hash,
               password_iterations,global_role,created_at,updated_at)
               VALUES(?, 'test@example.org',?,?,300000,'super_admin',?,?)""",
            (uid, "a"*32, "b"*64, at, at))
        self.db.execute(
            """INSERT INTO exotel_operator_test_calls
               (id,actor_user_id,rate_slot,state,created_at,updated_at)
               VALUES(?,?,?,'reserved',?,?)""",
            ("e4ee8ca8-e8f2-422c-82c6-68c51143fc00",uid,"29914800",at,at))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO exotel_operator_test_calls
                   (id,actor_user_id,rate_slot,state,created_at,updated_at)
                   VALUES(?,?,?,'reserved',?,?)""",
                ("e4ee8ca8-e8f2-422c-82c6-68c51143fc01",uid,"29914800",at,at))
        self.db.execute(
            """UPDATE exotel_operator_test_calls SET state='submitted',
               provider_call_sid='CA001234567890',updated_at=?
               WHERE rate_slot=?""",(at,"29914800"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE exotel_operator_test_calls SET state='unknown' WHERE rate_slot=?",
                ("29914800",))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "DELETE FROM exotel_operator_test_calls WHERE rate_slot=?",("29914800",))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE exotel_operator_test_calls SET actor_user_id=? WHERE rate_slot=?",
                ("another", "29914800"))
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM exotel_operator_test_calls").fetchone()[0],1)

    def test_no_crm_tables_or_customer_call_flag_created_in_control_db(self):
        names={row[0] for row in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("exotel_operator_test_calls",names)
        self.assertNotIn("leads",names)
        self.assertNotIn("calls",names)
        self.assertNotIn("voicebot_qualification_reviews",names)

if __name__ == "__main__":
    unittest.main()
