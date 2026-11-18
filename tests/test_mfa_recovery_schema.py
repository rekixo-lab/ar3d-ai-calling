import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
class RecoverySchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for filename in ('0001_init.sql','0002_human_access.sql','0003_ip_login_limits.sql','0004_super_admin_mfa.sql','0005_mfa_recovery.sql'):
            self.db.executescript((ROOT/'migrations/control'/filename).read_text())
        self.db.execute("""INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,created_at,updated_at)
          VALUES ('admin','admin@example.test', ?, ?, 240000,'now','now')""",('a'*32,'b'*64))
        self.db.execute("""INSERT INTO human_mfa_settings(user_id,secret_ciphertext,secret_iv,created_at,updated_at,enabled_at,recovery_generation_id)
          VALUES ('admin',?,?,'now','now','now','first')""",('c'*72,'d'*24))
    def tearDown(self):self.db.close()
    def test_recovery_code_is_unique_and_one_time(self):
        h='e'*64
        self.db.execute("INSERT INTO human_mfa_recovery_codes(user_id,code_hash,created_at) VALUES('admin',?,'now')",(h,))
        self.assertEqual(self.db.execute("UPDATE human_mfa_recovery_codes SET used_at='now' WHERE user_id='admin' AND code_hash=? AND used_at IS NULL",(h,)).rowcount,1)
        self.assertEqual(self.db.execute("UPDATE human_mfa_recovery_codes SET used_at='later' WHERE user_id='admin' AND code_hash=? AND used_at IS NULL",(h,)).rowcount,0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_mfa_recovery_codes(user_id,code_hash,created_at) VALUES('admin',?,'now')",(h,))
    def test_unknown_user_or_plaintext_code_not_accepted(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_mfa_recovery_codes VALUES('missing',?,'now',NULL)",('a'*64,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_mfa_recovery_codes VALUES('admin','AR3D-plaintext','now',NULL)")
    def test_generation_guard_prevents_stale_code_insertion(self):
        self.db.execute("""INSERT INTO human_mfa_recovery_codes(user_id,code_hash,created_at)
          SELECT user_id,?,'now' FROM human_mfa_settings WHERE user_id='admin' AND recovery_generation_id='wrong'""",('a'*64,))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM human_mfa_recovery_codes").fetchone()[0],0)
        self.db.execute("""INSERT INTO human_mfa_recovery_codes(user_id,code_hash,created_at)
          SELECT user_id,?,'now' FROM human_mfa_settings WHERE user_id='admin' AND recovery_generation_id='first'""",('a'*64,))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM human_mfa_recovery_codes").fetchone()[0],1)
    def test_regeneration_discards_old_hashes(self):
        self.db.execute("INSERT INTO human_mfa_recovery_codes VALUES('admin',?,'now',NULL)",('a'*64,))
        self.db.execute("UPDATE human_mfa_settings SET recovery_generation_id='next' WHERE user_id='admin'")
        self.db.execute("""DELETE FROM human_mfa_recovery_codes WHERE user_id='admin' AND EXISTS
          (SELECT 1 FROM human_mfa_settings WHERE user_id='admin' AND recovery_generation_id='next')""")
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM human_mfa_recovery_codes').fetchone()[0],0)
if __name__=='__main__':unittest.main()
