"""Offline additive Exotel CRM review schema acceptance, no cloud or calls."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
TENANT="11111111-1111-4111-8111-111111111111"
OTHER="22222222-2222-4222-8222-222222222222"
LEAD="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
AT="2026-11-20T00:00:00.000Z"


def database():
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for path in sorted((ROOT/"migrations"/"crm").glob("*.sql")):
        db.executescript(path.read_text())
    return db


class VoicebotReviewSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db=database()
        self.db.execute(
            "INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (TENANT,LEAD,"Fictional Test Lead","+919000000001","excel",AT,AT)
        )
    def tearDown(self):
        self.db.close()
    def insert(self,tenant=TENANT,source=1,call="CAfictionalcall20261120",record_id=ID):
        self.db.execute(
            "INSERT INTO voicebot_qualification_reviews"
            "(tenant_id,id,lead_id,provider,call_reference,provider_account_hash,"
            "delivery_digest,survey_json,source_verified,mapping_verified,"
            "possible_opt_out,status,created_at)"
            "VALUES(?,?,?,'exotel',?,?,?,?,?,1,0,'pending',?)",
            (tenant,record_id,LEAD,call,"a"*64,"b"*64,
             '{"propertyType":"plot"}',source,AT)
        )
    def test_only_verified_and_tenant_owned_rows(self):
        self.insert()
        row=self.db.execute(
            "SELECT status,source_verified,mapping_verified FROM voicebot_qualification_reviews"
        ).fetchone()
        self.assertEqual(row,("pending",1,1))
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(tenant=OTHER,record_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(source=0,call="CAfakeuntrustedcall2026",
                        record_id="dddddddd-dddd-4ddd-8ddd-dddddddddddd")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(call="CAfictionalcall20261120",
                        record_id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    def test_immutable_vendor_evidence_and_final_status(self):
        self.insert()
        for field in ["delivery_digest","survey_json","lead_id","possible_opt_out"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(
                    "UPDATE voicebot_qualification_reviews SET "+field+"=? WHERE tenant_id=? AND id=?",
                    (("c"*64) if field=="delivery_digest" else "{}" if field=="survey_json" else LEAD if field=="lead_id" else 1,TENANT,ID)
                )
        self.db.execute(
            "UPDATE voicebot_qualification_reviews SET status='applied',reviewed_by=?,reviewed_at=? "
            "WHERE tenant_id=? AND id=?",("fictional-admin",AT,TENANT,ID)
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE voicebot_qualification_reviews SET status='pending',"
                "reviewed_by=NULL,reviewed_at=NULL WHERE tenant_id=? AND id=?",
                (TENANT,ID)
            )
    def test_call_and_consent_protection_remain(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE leads SET consent_status='granted',dnd_status='allowed' "
                "WHERE tenant_id=? AND id=?",(TENANT,LEAD)
            )
        self.db.execute(
            "INSERT INTO agents(tenant_id,id,display_name,created_at,updated_at) "
            "VALUES(?,?,?,?,?)",(TENANT,"draft-agent","Draft",AT,AT)
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO calls(tenant_id,id,lead_id,agent_id,created_at) "
                "VALUES(?,?,?,?,?)",(TENANT,"fake-call",LEAD,"draft-agent",AT)
            )
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0],"ok")


if __name__=="__main__":
    unittest.main()
