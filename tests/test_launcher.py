"""Desktop launcher: pure functions + heartbeat endpoint. Run: python -m pytest tests/test_launcher.py -q"""
import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app import launcher  # noqa: E402


def test_data_dir_override(tmp_path):
    assert launcher.resolve_data_dir(tmp_path, {}, str(tmp_path / "x")) == (tmp_path / "x").resolve()


def test_data_dir_installed(tmp_path):
    d = launcher.resolve_data_dir(tmp_path, {"LOCALAPPDATA": str(tmp_path / "L")})
    assert d == tmp_path / "L" / "GuiaMHW"


def test_data_dir_portable_and_fallback(tmp_path):
    (tmp_path / "portable.txt").write_text("")
    env = {"LOCALAPPDATA": str(tmp_path / "L")}
    assert launcher.resolve_data_dir(tmp_path, env, check_writable=lambda p: True) == tmp_path / "data"
    assert launcher.resolve_data_dir(tmp_path, env, check_writable=lambda p: False) == tmp_path / "L" / "GuiaMHW"


def test_edge_validation(tmp_path):
    good = tmp_path / "msedge.exe"
    good.write_text("")
    other = tmp_path / "chrome.exe"
    other.write_text("")
    assert launcher.validate_edge_path(str(good))
    assert not launcher.validate_edge_path(str(other))
    assert not launcher.validate_edge_path("msedge.exe")  # relative
    assert not launcher.validate_edge_path(str(tmp_path / "nope" / "msedge.exe"))  # missing
    assert not launcher.validate_edge_path(None)


def test_edge_argv_safe(tmp_path):
    argv = launcher.build_edge_argv("C:\\x\\msedge.exe", 8765, tmp_path)
    assert argv[0].endswith("msedge.exe") and "--app=http://127.0.0.1:8765/" in argv
    assert any(a.startswith("--user-data-dir=") and "edge-profile" in a for a in argv)
    for a in argv:
        low = a.lower()
        assert not any(f in low for f in ("remote-debugging", "disable-web-security", "no-sandbox", "allow-running",
                                          "disable-site-isolation", "ignore-certificate"))


def test_bind_port_skips_busy():
    base = 48500
    busy = []
    for p in (base, base + 1):
        s = socket.socket()
        s.bind(("127.0.0.1", p))
        s.listen()
        busy.append(s)
    got = launcher.bind_port("127.0.0.1", base, base + 3)
    try:
        assert got.getsockname() == ("127.0.0.1", base + 2)
    finally:
        got.close()
        for s in busy:
            s.close()


def test_bind_port_exhausted():
    s = socket.socket()
    s.bind(("127.0.0.1", 48520))
    s.listen()
    try:
        with pytest.raises(launcher.StartupError):
            launcher.bind_port("127.0.0.1", 48520, 48520)
    finally:
        s.close()


def test_mutex_name(tmp_path):
    a, b = launcher.mutex_name(tmp_path / "a"), launcher.mutex_name(tmp_path / "b")
    assert a != b and a == launcher.mutex_name(tmp_path / "a")
    assert a.startswith("Local\\GuiaMHW-") and len(a) == len("Local\\GuiaMHW-") + 12


def test_watchdog_fake_clock():
    t = [100.0]
    dog = launcher.Watchdog(100.0, clock=lambda: t[0], timeout=45, grace=120)
    t[0] = 200
    assert not dog.should_stop(None)        # within the first-beat grace
    t[0] = 221
    assert dog.should_stop(None)            # no beat ever
    t[0] = 300
    assert not dog.should_stop(290.0)
    t[0] = 336
    assert dog.should_stop(290.0)           # 46 s without a beat


def test_edge_not_started_in_tests(monkeypatch):
    # Guard: nothing in these tests may spawn processes.
    monkeypatch.setattr(launcher.subprocess, "Popen", lambda *a, **k: pytest.fail("Popen called"))


def test_heartbeat_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("MHW_USER_DATA_DIR", str(tmp_path))
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app import desktop
    from app.version import VERSION
    app = FastAPI()
    app.include_router(desktop.router)

    @app.middleware("http")
    async def guard(request, call_next):  # same contract as main._guard_writes
        from fastapi.responses import JSONResponse
        if request.method == "POST" and request.headers.get("x-mhw-client") != "1":
            return JSONResponse({"detail": "x"}, status_code=403)
        return await call_next(request)

    c = TestClient(app)
    assert c.get("/api/app/info").json() == {"name": "Guía MHW", "version": VERSION, "frozen": False}
    desktop._last_beat = None
    assert c.post("/api/app/heartbeat").status_code == 403 and desktop.last_heartbeat() is None
    assert c.post("/api/app/heartbeat", headers={"X-MHW-Client": "1"}).status_code == 200
    assert desktop.last_heartbeat() is not None


def test_real_app_heartbeat_requires_header():
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)  # no lifespan context: routes only
    assert c.post("/api/app/heartbeat").status_code == 403
    assert c.post("/api/app/heartbeat", headers={"X-MHW-Client": "1"}).status_code == 200


def test_edge_argv_token_only_in_app_url(tmp_path):
    argv = launcher.build_edge_argv("C:/x/msedge.exe", 8765, tmp_path, "TKN")
    assert "--app=http://127.0.0.1:8765/?t=TKN" in argv
    assert sum("TKN" in a for a in argv) == 1


# ---- window-presence mode (Edge hand-off) and fallback watchdog

def _watch():
    t = [0.0]
    msgs = []
    w = launcher.WindowWatch(0.0, clock=lambda: t[0], logger=msgs.append)
    return w, t, msgs


def test_window_watch_stays_up_while_present():
    w, t, _ = _watch()
    for i in range(100):
        t[0] = i * 5.0
        assert not w.tick(True)


def test_window_watch_survives_two_misses_then_stops_on_third():
    w, t, msgs = _watch()
    assert not w.tick(True)
    assert not w.tick(False) and not w.tick(False)
    assert not w.tick(True)          # reappears: counter resets
    assert not w.tick(False) and not w.tick(False)
    assert w.tick(False)             # third consecutive miss
    assert any("gone" in m for m in msgs)


def test_window_watch_never_seen_times_out_at_120s():
    w, t, _ = _watch()
    t[0] = 119.0
    assert not w.tick(False)
    t[0] = 120.0
    assert w.tick(False)


def test_window_watch_ignores_heartbeat_silence():
    # No heartbeat input exists in window mode: a present window keeps it up however long nothing beats.
    w, t, _ = _watch()
    t[0] = 3600.0
    w.seen = True
    assert not w.tick(True)


def test_fallback_watchdog_timings():
    t = [0.0]
    dog = launcher.Watchdog(0.0, clock=lambda: t[0])
    assert launcher.HEARTBEAT_TIMEOUT == 600.0 and launcher.FIRST_BEAT_GRACE == 120.0
    t[0] = 120.0
    assert not dog.should_stop(None)
    t[0] = 121.0
    assert dog.should_stop(None)
    t[0] = 700.0
    assert not dog.should_stop(100.0)   # 600 s exactly
    t[0] = 701.0
    assert dog.should_stop(100.0)


def test_has_app_window_enumerator():
    from app import winutil
    wins = [("Chrome_WidgetWin_1", "Inicio · Guía MHW"), ("Notepad", "Guía MHW"), ("Chrome_WidgetWin_1", "")]
    assert winutil.has_app_window("Guía MHW", lambda: wins)
    assert not winutil.has_app_window("Guía MHW", lambda: wins[1:])
    assert not winutil.has_app_window("Guía MHW", lambda: [("Chrome_WidgetWin_1", "Otra")])
    assert not winutil.has_app_window("Guía MHW", lambda: [])


def test_desktop_activity_touch():
    from app import desktop
    desktop._last_beat = desktop._last_activity = None
    assert desktop.last_activity() is None
    desktop.touch()
    assert desktop.last_activity() is not None and desktop.last_heartbeat() is None
