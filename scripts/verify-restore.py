"""Replay a Calling SQL export in memory without opening another database."""
import sqlite3
import sys

TABLES = {
    "control": {"tenants", "human_users", "scripted_phone_pilots", "whatsapp_connections"},
    "crm": {"leads", "calling_jobs", "lead_opt_out_events", "whatsapp_messages"},
}


def authorize(action, first, second, database, trigger):
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_CREATE_VTABLE):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and (second or "").lower() in {
        "load_extension", "readfile", "writefile"
    }:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and (first or "").lower() not in {
        "foreign_keys", "defer_foreign_keys", "integrity_check", "foreign_key_check"
    }:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def verify(kind, sql):
    db = sqlite3.connect(":memory:")
    try:
        db.execute("PRAGMA temp_store=MEMORY")
        db.set_authorizer(authorize)
        db.executescript(sql)
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        return (TABLES[kind] <= tables
                and db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
                and db.execute("PRAGMA foreign_key_check").fetchone() is None)
    finally:
        db.close()


if __name__ == "__main__":
    try:
        sys.exit(0 if verify(sys.argv[1], sys.stdin.buffer.read().decode("utf-8")) else 1)
    except (ValueError, KeyError, sqlite3.Error):
        sys.exit(1)
