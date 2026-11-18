import sqlite3
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class MfaSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for f in ('0001_init.sql','0002_human_access.sql','0003_ip_login_limits.sql','0004_super_admin_mfa.sql'):
            self.db.executescript((ROOT/'migrations/control'/f).read_text())
        self.db.execute("""INSERT INTO human_users
        (id,email,password_salt,password_hash,password_iterations,created_at,updated_at)
        VALUES ('u','u@example.test',?,?,240000,'now','now')""",('a'*32,'b'*64))
    def tearDown(self):self.db.close()
    def test_encryption_iv_and_ciphertext_lengths_enforced(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO human_mfa_settings
            (user_id,secret_ciphertext,secret_iv,created_at,updated_at)
            VALUES('u','rawsecret','x','now','now')""")
    def test_settings_reference_existing_human_user(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO human_mfa_settings
            (user_id,secret_ciphertext,secret_iv,created_at,updated_at)
            VALUES('missing',?,?,'now','now')""",('a'*72,'b'*24))
    def test_mfa_challenge_attempt_limit(self):
        self.db.execute("""INSERT INTO human_mfa_challenges
        (token_hash,user_id,created_at,expires_at,attempts) VALUES (?, 'u','now',100,4)""",('c'*64,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE human_mfa_challenges SET attempts=6")
    def test_enabled_status_and_replay_step_stored(self):
        self.db.execute("""INSERT INTO human_mfa_settings
        (user_id,secret_ciphertext,secret_iv,enabled_at,last_used_step,created_at,updated_at)
        VALUES('u',?,?, 'now',123,'now','now')""",('a'*72,'b'*24))
        self.assertEqual(self.db.execute('SELECT last_used_step FROM human_mfa_settings').fetchone()[0],123)
if __name__=='__main__': unittest.main()
