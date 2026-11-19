#!/usr/bin/env python3
"""Interactive one-time Super Admin bootstrap. Never exposes secrets in argv.

Only for the isolated ar3d-ai-calling.<subdomain>.workers.dev host.
Runs from the operator's own trusted terminal after explicit Cloudflare deploy.
No third-party libraries; no credentials are written to disk or printed.
"""
import getpass
import json
import re
import secrets
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def validate_host(raw: str) -> str:
    parsed = urllib.parse.urlparse(raw)
    if (parsed.scheme != "https" or parsed.username or parsed.password or
        parsed.port is not None or parsed.path not in ("", "/") or
        parsed.params or parsed.query or parsed.fragment or
        not re.fullmatch(r"ar3d-ai-calling\.[a-z0-9-]+\.workers\.dev", parsed.hostname or "")):
        raise ValueError("Use only the isolated HTTPS ar3d-ai-calling.<subdomain>.workers.dev URL")
    return "https://" + parsed.hostname


def build_request(host: str, email: str, password: str, token: str):
    url = validate_host(host)
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError("Bootstrap token must be 32+ characters")
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise ValueError("Super Admin password must be 12-128 characters")
    email = email.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", email):
        raise ValueError("Enter a valid email address")
    payload = json.dumps({"email": email, "password": password}, ensure_ascii=False).encode("utf-8")
    return urllib.request.Request(
        url + "/v1/human/bootstrap",
        data=payload,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )


def bootstrap(host: str, email: str, password: str, token: str,
              opener=None, retry_unauthorized=False, sleeper=None) -> int:
    """Retry only the exact Worker JSON 401, not upstream/ambiguous failures.

    All attempts use the same in-memory password and token, with no reupload.
    Normal, non-synchronized mode continues to make just one request.
    """
    request = build_request(host, email, password, token)
    if opener is None:
        opener = urllib.request.urlopen
    if sleeper is None:
        sleeper = time.sleep
    delays = (0, 5, 10, 15) if retry_unauthorized else (0,)
    for attempt, delay in enumerate(delays):
        if delay:
            print("Retrying existing bootstrap request after " + str(delay) +
                  " seconds (same in-memory token; no secret change).")
            sleeper(delay)
        try:
            with opener(request, timeout=20, context=ssl.create_default_context()) as reply:
                if reply.status != 201:
                    print("Bootstrap was not confirmed (unexpected HTTP status " +
                          str(reply.status) + ").")
                    return 1
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                # Do not mistake an upstream 401 for an application rejection.
                # Neither token nor response body is ever printed.
                worker_denied = False
                try:
                    content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
                    body = exc.read(256)
                    worker_denied = (
                        content_type.lower().split(";", 1)[0].strip() == "application/json"
                        and json.loads(body) == {"error": "unauthorized"}
                    )
                except (ValueError, UnicodeError, OSError):
                    pass
                if worker_denied and attempt < len(delays) - 1:
                    print("Worker HTTP 401; waiting for possible secret propagation.")
                    continue
                if worker_denied:
                    print("Bootstrap HTTP 401: Worker rejected the token. "
                          "A present secret name does not prove its value matched.")
                else:
                    print("Bootstrap HTTP 401: response is not the expected Worker JSON. "
                          "Check Cloudflare access or upstream routing.")
            elif exc.code == 403:
                print("Bootstrap HTTP 403: forbidden. No automatic retry.")
            elif exc.code == 409:
                print("Super Admin already exists. Do NOT repeat bootstrap.")
            else:
                print("Bootstrap failed with HTTP status " + str(exc.code) + ".")
            return 1
        except (urllib.error.URLError, TimeoutError, OSError):
            print("Connection failed or result unknown. No automatic retry; "
                  "verify admin state before trying again.")
            return 1
        print("Super Admin created. Sign in at " + validate_host(host) + "/app")
        print("IMPORTANT: Remove ADMIN_BOOTSTRAP_TOKEN from the Worker now.")
        return 0
    return 1

# This operation is limited to a single existing standalone Cloudflare Worker.
# No credentials are passed via argv, printed or persisted to disk.
PRODUCTION_WORKER = "ar3d-ai-calling"
PRODUCTION_URL = "https://ar3d-ai-calling.ai-8f3.workers.dev"


def upload_one_time_token(token: str, runner=None) -> bool:
    """Put token directly into the existing Worker via locally authenticated Wrangler.

    Use an empty temporary directory so an unrelated repo's Wrangler config
    can never redirect the command. The Worker name is exact and fixed.
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise ValueError("Expected a freshly generated 256-bit URL-safe token")
    if runner is None:
        runner = subprocess.run
    command = [
        "npx", "--yes", "wrangler@4", "secret", "put", "ADMIN_BOOTSTRAP_TOKEN",
        "--name", PRODUCTION_WORKER,
    ]
    with tempfile.TemporaryDirectory(prefix="ar3d-calling-bootstrap-") as workdir:
        try:
            result = runner(
                command, input=token + "\n", text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=workdir, timeout=180, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            print("Cloudflare sync failed; check Node.js/npm and Wrangler login. Token hidden.")
            return False
    if result.returncode != 0:
        print("Cloudflare sync rejected. Run: npx --yes wrangler@4 login")
        print("Ensure you authorize the account containing ONLY ar3d-ai-calling, then retry.")
        print("No credentials or provider error output is shown.")
        return False
    print("One-time bootstrap secret synchronized directly to ar3d-ai-calling (value hidden).")
    return True


def synchronized_bootstrap(raw_host: str) -> int:
    """Generate once, upload once, bootstrap using the SAME in-memory token."""
    host = validate_host(raw_host)
    if host != PRODUCTION_URL:
        raise ValueError("Secure sync is permitted only for the verified main Calling Worker URL")
    email = input("Super Admin email: ")
    password = getpass.getpass("New Super Admin password (hidden): ")
    again = getpass.getpass("Confirm password (hidden): ")
    if password != again:
        print("Passwords do not match. No secret was changed.")
        return 2
    # Validate both credentials before even uploading the new secret.
    build_request(host, email, password, "X" * 43)
    token = secrets.token_urlsafe(32)
    if not upload_one_time_token(token):
        return 1
    # Retry only the exact Worker JSON 401 after a secret change.
    return bootstrap(host, email, password, token, retry_unauthorized=True)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 2 and argv[0] == "--sync-worker-secret":
        try:
            return synchronized_bootstrap(argv[1])
        except (ValueError, EOFError, KeyboardInterrupt):
            print("Synchronized bootstrap cancelled or invalid input. Secret not displayed.")
            return 2
    if len(argv) != 1:
        print("Usage: python3 scripts/bootstrap-main.py [--sync-worker-secret] https://ar3d-ai-calling.<subdomain>.workers.dev")
        return 2
    try:
        host = validate_host(argv[0])
        email = input("Super Admin email: ")
        raw_token = getpass.getpass("One-time Worker bootstrap token (hidden): ")
        token = raw_token.strip()
        if token != raw_token:
            print("Note: surrounding whitespace was trimmed from the pasted token.")
        if len(token) < 32:
            print("Token is too short. Copy the actual ADMIN_BOOTSTRAP_TOKEN, not its name.")
            return 2
        print("Bootstrap token input received (" + str(len(token)) + " characters; value hidden).")
        password = getpass.getpass("New Super Admin password (hidden): ")
        again = getpass.getpass("Confirm password (hidden): ")
        if password != again:
            print("Passwords do not match; no request sent.")
            return 2
        return bootstrap(host, email, password, token)
    except (ValueError, EOFError, KeyboardInterrupt) as exc:
        print("Bootstrap cancelled or invalid input. No credentials displayed.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
