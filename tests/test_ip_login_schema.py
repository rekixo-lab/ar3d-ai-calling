import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
class IpLoginSecuritySchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        for sql in ('0001_init.sql','0002_human_access.sql','0003_ip_login_limits.sql'):
            self.db.executescript((ROOT/'migrations/control'/sql).read_text())
    def tearDown(self):
        self.db.close()

    def test_hmac_keys_only_and_cannot_store_raw_ip(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_ip_login_limits VALUES('203.0.113.45',1,0,0)")
        key='a'*64
        self.db.execute("INSERT INTO human_ip_login_limits VALUES(?,?,?,?)",(key,1,0,0))
        self.assertEqual(self.db.execute("SELECT ip_hash FROM human_ip_login_limits").fetchone()[0],key)

    def test_attempt_count_nonnegative(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO human_ip_login_limits VALUES(?,?,?,?)",('b'*64,-1,100,0))

    def test_atomic_sql_upsert_can_lock_and_reset(self):
        sql="""INSERT INTO human_ip_login_limits(ip_hash,attempt_count,window_start,blocked_until)
          VALUES(?,1,?,0)
          ON CONFLICT(ip_hash) DO UPDATE SET
          attempt_count=CASE WHEN human_ip_login_limits.window_start<=? THEN 1 ELSE human_ip_login_limits.attempt_count+1 END,
          window_start=CASE WHEN human_ip_login_limits.window_start<=? THEN ? ELSE human_ip_login_limits.window_start END,
          blocked_until=CASE WHEN human_ip_login_limits.blocked_until>? THEN human_ip_login_limits.blocked_until
            WHEN human_ip_login_limits.window_start<=? THEN 0
            WHEN human_ip_login_limits.attempt_count>=? THEN ? ELSE 0 END
          RETURNING attempt_count,blocked_until"""
        def advance(now):
            return self.db.execute(sql,('a'*64,now,now-900000,now-900000,now,now,now-900000,60,now+900000)).fetchone()
        self.assertEqual(advance(100000),(1,0))
        for n in range(2,61):
            self.assertEqual(advance(100000+n)[0],n)
        self.assertGreater(advance(100061)[1],100061)
        self.assertEqual(advance(100000+1800000),(1,0))

if __name__=='__main__':
    unittest.main()
