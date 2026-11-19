"""Offline SQLite backup/restore DRILL with strictly fictional records.

Runs under the existing Python unit test suite. This does not access Cloudflare
D1/R2, production accounts, customer phones or live services; it cannot replace
a separately authorized and tested remote backup/restore runbook.
"""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
AT = "2026-11-19T00:00:00.000Z"
TENANT_A = "11111111-1111-4111-8111-111111111111"
TENANT_B = "22222222-2222-4222-8222-222222222222"
LEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
LEAD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def fresh_database(kind):
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for path in sorted((ROOT / "migrations" / kind).glob("*.sql")):
        db.executescript(path.read_text(encoding="utf-8"))
    assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    return db


def verify_consistency(db):
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []


class OfflineRestoreAcceptanceTests(unittest.TestCase):
    def test_control_backup_preserves_tenant_identities_audit_and_safety(self):
        source = fresh_database("control")
        restored = sqlite3.connect(":memory:")
        try:
            for tid, slug in ((TENANT_A, "fictional-a"), (TENANT_B, "fictional-b")):
                source.execute(
                    "INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)"
                    " VALUES(?,?,?,'starter','shared','trial',?,?)",
                    (tid, slug, slug, AT, AT),
                )
            source.execute(
                "INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,created_at)"
                " VALUES(?,?, 'synthetic_test','tenant.created',?,?)",
                ("audit-fictional-01", TENANT_A, TENANT_A, AT),
            )
            source.commit()
            verify_consistency(source)
            source.backup(restored)
            restored.execute("PRAGMA foreign_keys=ON")
            verify_consistency(restored)
            self.assertEqual(
                restored.execute("SELECT slug FROM tenants WHERE id=?", (TENANT_A,)).fetchone()[0],
                "fictional-a",
            )
            self.assertEqual(
                restored.execute("SELECT COUNT(*) FROM tenant_audit_events WHERE tenant_id=?", (TENANT_A,)).fetchone()[0],
                1,
            )
            source.execute("UPDATE tenants SET display_name='changed-after-backup' WHERE id=?", (TENANT_A,))
            source.commit()
            self.assertEqual(
                restored.execute("SELECT display_name FROM tenants WHERE id=?", (TENANT_A,)).fetchone()[0],
                "fictional-a",
            )
            with self.assertRaises(sqlite3.IntegrityError):
                restored.execute(
                    "INSERT INTO tenant_keys(id,tenant_id,token_hash,name,role,created_at)"
                    " VALUES('orphan','no-such-tenant',?, 'test', 'client_admin',?)",
                    ("0" * 64, AT),
                )
        finally:
            restored.close()
            source.close()

    def test_crm_restore_preserves_suppression_and_call_deny_triggers(self):
        source = fresh_database("crm")
        restored = sqlite3.connect(":memory:")
        try:
            for tid, lead_id, name in (
                (TENANT_A, LEAD_A, "Fictional Customer A"),
                (TENANT_B, LEAD_B, "Fictional Customer B"),
            ):
                source.execute(
                    "INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)"
                    " VALUES(?,?,?,?,'excel',?,?)",
                    (tid, lead_id, name, "+919000000001", AT, AT),
                )
            source.execute(
                "UPDATE leads SET consent_status='denied',dnd_status='blocked'"
                " WHERE tenant_id=? AND id=?", (TENANT_A, LEAD_A),
            )
            source.execute(
                "INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at)"
                " VALUES(?,?,?,'customer_request','synthetic_test',?)",
                (TENANT_A, "optout-01", LEAD_A, AT),
            )
            source.commit()
            verify_consistency(source)
            source.backup(restored)
            restored.execute("PRAGMA foreign_keys=ON")
            verify_consistency(restored)
            self.assertEqual(
                restored.execute(
                    "SELECT COUNT(*) FROM leads WHERE tenant_id=?", (TENANT_A,)
                ).fetchone()[0], 1,
            )
            self.assertEqual(
                restored.execute("SELECT COUNT(*) FROM lead_opt_out_events").fetchone()[0], 1,
            )
            self.assertEqual(
                restored.execute(
                    "SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?",
                    (TENANT_A, LEAD_A),
                ).fetchone(), ("denied", "blocked"),
            )
            with self.assertRaises(sqlite3.IntegrityError):
                restored.execute(
                    "UPDATE leads SET consent_status='granted',dnd_status='allowed',"
                    " consent_proof='fake',consent_at=? WHERE tenant_id=? AND id=?",
                    (AT, TENANT_A, LEAD_A),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                restored.execute(
                    "INSERT INTO agents(tenant_id,id,display_name,status,created_at,updated_at)"
                    " VALUES(?,?,'Not Allowed','active',?,?)",
                    (TENANT_A, "agent-fake", AT, AT),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                restored.execute(
                    "INSERT INTO calls(tenant_id,id,lead_id,agent_id,created_at)"
                    " VALUES(?,?,?,?,?)",
                    (TENANT_A, "call-fake", LEAD_A, "agent-fake", AT),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                restored.execute(
                    "INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,created_at)"
                    " VALUES(?,?,?,?,?)",
                    (TENANT_A, "cross-tenant-visit", LEAD_B, AT, AT),
                )
            source.execute(
                "UPDATE leads SET name='changed-after-backup' WHERE tenant_id=? AND id=?",
                (TENANT_B, LEAD_B),
            )
            source.commit()
            self.assertEqual(
                restored.execute(
                    "SELECT name FROM leads WHERE tenant_id=? AND id=?", (TENANT_B, LEAD_B)
                ).fetchone()[0], "Fictional Customer B",
            )
            for trigger in ("trg_no_call_launch", "trg_agents_block_active_insert",
                            "trg_prevent_lead_opt_out_reversal"):
                self.assertTrue(restored.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?", (trigger,)
                ).fetchone(), trigger)
            verify_consistency(restored)
        finally:
            restored.close()
            source.close()


if __name__ == "__main__":
    unittest.main()
