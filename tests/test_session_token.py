"""F6: per-launch session token. Each scenario runs in a subprocess so MHW_SESSION_TOKEN is set BEFORE `app` imports."""
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "build" / "catalog.db"
pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")
TOKEN = "tok_ABC-123_secret"

SCRIPT = textwrap.dedent("""
    import json
    from starlette.testclient import TestClient
    from app.main import app
    H = {"X-MHW-Client": "1"}
    out = {}
    with TestClient(app, base_url="http://127.0.0.1") as c:
        def rec(k, r):
            out[k] = {"s": r.status_code, "body": r.text, "h": dict(r.headers), "sc": r.headers.get("set-cookie")}
        rec("get_nocookie", c.get("/api/stats"))
        rec("post_nocookie", c.post("/api/app/heartbeat", headers=H))
        rec("get_wrong", c.get("/api/stats", cookies={"mhw_session": "nope"}))
        rec("get_good", c.get("/api/stats", cookies={"mhw_session": TOKEN}))
        rec("post_good", c.post("/api/app/heartbeat", headers=H, cookies={"mhw_session": TOKEN}))
        rec("post_good_nohdr", c.post("/api/app/heartbeat", cookies={"mhw_session": TOKEN}))
        rec("health", c.get("/api/health"))
        rec("info_good", c.get("/api/app/info", cookies={"mhw_session": TOKEN}))
        rec("entry_good", c.get("/?t=" + TOKEN, follow_redirects=False))
        rec("entry_bad", c.get("/?t=bad", follow_redirects=False))
        rec("entry_notoken", c.get("/", follow_redirects=False))
    print("JSON:" + json.dumps(out))
""").replace("TOKEN", repr(TOKEN))


def _run(tmp_path, token):
    env = dict(os.environ, MHW_CATALOG_DB=str(ROOT / "build" / "catalog.db"), MHW_USER_DATA_DIR=str(tmp_path / "ud"),
               MHW_WEB_DIST=str(tmp_path / "web"))
    env.pop("MHW_SESSION_TOKEN", None)
    if token:
        env["MHW_SESSION_TOKEN"] = token
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text('<div id="root"></div>')
    p = subprocess.run([sys.executable, "-c", SCRIPT], cwd=ROOT / "api", env=env, capture_output=True, text=True,
                       timeout=120)
    line = next((ln for ln in p.stdout.splitlines() if ln.startswith("JSON:")), None)
    assert line, p.stderr[-2000:]
    return json.loads(line[5:])


def test_token_enforced(tmp_path):
    r = _run(tmp_path, TOKEN)
    assert r["get_nocookie"]["s"] == 401 and r["post_nocookie"]["s"] == 401
    assert json.loads(r["get_nocookie"]["body"]) == {"detail": "Sesión no válida"}
    assert r["get_wrong"]["s"] == 401
    assert r["get_good"]["s"] == 200 and r["post_good"]["s"] == 200
    assert r["post_good_nohdr"]["s"] == 403  # existing X-MHW-Client check still applies
    assert r["health"]["s"] == 200 and r["health"]["body"].replace(" ", "") == '{"ok":true}'
    assert r["info_good"]["s"] == 200


def test_entry_redirect_sets_cookie(tmp_path):
    r = _run(tmp_path, TOKEN)
    g = r["entry_good"]
    assert g["s"] == 302 and g["h"]["location"] == "/"
    sc = g["sc"].lower()
    assert f"mhw_session={TOKEN}".lower() in sc and "httponly" in sc and "samesite=strict" in sc and "path=/" in sc
    assert "secure" not in sc.replace("samesite", "")
    assert g["h"]["referrer-policy"] == "no-referrer" and g["h"]["cache-control"] == "no-store"
    assert r["entry_bad"]["sc"] is None and r["entry_bad"]["s"] == 200
    assert r["entry_notoken"]["sc"] is None


def test_token_never_in_bodies(tmp_path):
    r = _run(tmp_path, TOKEN)
    for k, v in r.items():
        assert TOKEN not in v["body"], k
        if k != "entry_good":
            assert v["sc"] is None or TOKEN not in v["sc"], k
            assert TOKEN not in json.dumps(v["h"]), k


def test_dev_mode_unaffected(tmp_path):
    r = _run(tmp_path, None)
    assert r["get_nocookie"]["s"] == 200 and r["post_nocookie"]["s"] == 200
    assert r["entry_good"]["s"] == 200 and r["entry_good"]["sc"] is None
