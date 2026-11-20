import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCHEMA=ROOT/'migrations/control/0008_exotel_voicebot_receipts.sql'

class ExotelWebhookReceiptSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA.read_text())

    def tearDown(self):
        self.db.close()

    def insert(self,key='a'*64,kind='transcript',status='quarantined'):
        self.db.execute("""
          INSERT INTO exotel_voicebot_event_receipts(
          receipt_key,account_fingerprint,session_fingerprint,call_fingerprint,
          conversation_fingerprint,event_fingerprint,payload_digest,event_kind,
          turn_status,possible_opt_out,status,received_at,expires_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,(key,'b'*64,'c'*64,'d'*64,'e'*64,'f'*64,'0'*64,
             kind,'completed' if kind=='transcript' else 'none',
             0,status,'2026-11-20T00:00:00.000Z',1795132800000))

    def test_schema_quarantine_only_and_unique_receipt_key(self):
        self.insert()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(key='g'*64,status='processed')
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(key='h'*64,kind='phone-call')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE exotel_voicebot_event_receipts SET possible_opt_out=1")
        self.assertEqual(self.db.execute("SELECT status FROM exotel_voicebot_event_receipts").fetchone()[0],
                         'quarantined')

    def test_receipt_contains_no_phone_or_transcript_columns(self):
        names=[row[1] for row in self.db.execute('PRAGMA table_info(exotel_voicebot_event_receipts)')]
        self.assertIn('receipt_key',names)
        self.assertIn('expires_at',names)
        for sensitive in ['phone','mobile','transcript','body','lead_id','tenant_id','payload_json']:
            self.assertNotIn(sensitive,names)

    def test_expiry_delete_permitted_for_future_retention_prune(self):
        self.insert()
        count=self.db.execute("DELETE FROM exotel_voicebot_event_receipts WHERE expires_at<=?",
                              (1795132800000,)).rowcount
        self.assertEqual(count,1)

if __name__=='__main__':
    unittest.main()
