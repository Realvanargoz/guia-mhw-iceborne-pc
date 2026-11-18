"""Desktop launcher: local server on 127.0.0.1 + Microsoft Edge in app mode. Closing the window stops the server.

Never: admin, services, autostart, firewall, PATH or registry writes. Edge gets no debugging/web-security flags.
`app` (settings) is imported only after MHW_USER_DATA_DIR is exported, so keep top-level imports free of it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import logging.handlers
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import winutil
from .version import VERSION

PORT_FIRST, PORT_LAST = 8765, 8775
HEARTBEAT_TIMEOUT = 600.0     # fallback (default browser) mode: no beat/API activity for this long -> stop
FIRST_BEAT_GRACE = 120.0      # fallback mode: no activity at all within this long after launch -> stop
WINDOW_POLL_SECONDS = 5.0     # Edge hand-off mode: how often to look for the app window
WINDOW_MISSES_TO_STOP = 3     # consecutive polls without the window (after it was seen) -> stop (15 s)
WINDOW_APPEAR_TIMEOUT = 120.0 # window never seen within this long after launch -> stop
EDGE_HANDOFF_SECONDS = 5.0    # Edge exiting faster than this handed the window to another process
APP_NAME = "Guía MHW"
log = logging.getLogger("guiamhw")


class StartupError(Exception):
    pass


# ------------------------------------------------------------------ pure helpers

def _writable_dir(p: Path) -> bool:
    try:
        p.mkdir(parents=True, exist_ok=True)
        probe = p / f".w{os.getpid()}"
        probe.write_text("x")
        probe.unlink()
        return True
    except OSError:
        return False


def resolve_data_dir(exe_dir: Path, env: dict, override: str | None = None, check_writable=_writable_dir) -> Path:
    if override:
        return Path(override).expanduser().resolve()
    local = Path(env.get("LOCALAPPDATA") or Path.home()) / "GuiaMHW"
    if (exe_dir / "portable.txt").is_file():
        d = exe_dir / "data"
        return d if check_writable(d) else local
    return local


def mutex_name(data_dir: Path | str) -> str:
    norm = os.path.normcase(os.path.abspath(str(data_dir)))
    return "Local\\GuiaMHW-" + hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def validate_edge_path(p: str | None) -> bool:
    return bool(p) and os.path.isabs(p) and os.path.basename(p).lower() == "msedge.exe" and os.path.isfile(p)


def build_edge_argv(edge: str, port: int, data_dir: Path | str, token: str | None = None) -> list[str]:
    # The token only travels in this one URL (visible to same-user processes); the server trades it for a cookie.
    q = f"?t={token}" if token else ""
    return [edge, f"--app=http://127.0.0.1:{int(port)}/{q}", f"--user-data-dir={os.path.join(str(data_dir), 'edge-profile')}",
            "--no-first-run", "--no-default-browser-check", "--window-size=1280,860"]


def bind_port(host: str = "127.0.0.1", first: int = PORT_FIRST, last: int = PORT_LAST,
              make_socket=socket.socket) -> socket.socket:
    last_err = None
    for port in range(first, last + 1):
        s = make_socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            s.bind((host, port))
            s.set_inheritable(False)
            return s
        except OSError as e:
            last_err = e
            s.close()
    raise StartupError(f"No hay ningún puerto libre entre {first} y {last} ({last_err}).")


class Watchdog:
    """Pure heartbeat logic. `beat` is the monotonic time of the last heartbeat (None = none yet)."""

    def __init__(self, started_at: float, clock=time.monotonic, timeout=HEARTBEAT_TIMEOUT, grace=FIRST_BEAT_GRACE):
        self.started_at, self.clock, self.timeout, self.grace = started_at, clock, timeout, grace

    def should_stop(self, beat: float | None) -> bool:
        now = self.clock()
        if beat is None:
            return now - self.started_at > self.grace
        return now - beat > self.timeout


class WindowWatch:
    """Pure window-presence logic for Edge hand-off mode. Feed `tick(present)` once per poll; True means stop."""

    def __init__(self, started_at: float, clock=time.monotonic, misses=WINDOW_MISSES_TO_STOP,
                 appear_timeout=WINDOW_APPEAR_TIMEOUT, logger=None):
        self.started_at, self.clock, self.misses_to_stop, self.appear_timeout = started_at, clock, misses, appear_timeout
        self.seen = False
        self.misses = 0
        self._log = logger or log.info

    def tick(self, present: bool) -> bool:
        if present:
            if not self.seen:
                self._log("app window found")
            elif self.misses:
                self._log("app window back")
            self.seen, self.misses = True, 0
            return False
        if not self.seen:
            if self.clock() - self.started_at >= self.appear_timeout:
                self._log("app window never appeared; stopping")
                return True
            return False
        self.misses += 1
        if self.misses == 1:
            self._log("app window gone; stopping in %d s" % int((self.misses_to_stop - 1) * WINDOW_POLL_SECONDS))
        return self.misses >= self.misses_to_stop


def open_own_url(port: int, token: str | None = None) -> None:
    """Open the default browser, ONLY on our own loopback URL."""
    url = f"http://127.0.0.1:{int(port)}/" + (f"?t={token}" if token else "")
    if hasattr(os, "startfile"):
        os.startfile(url)  # noqa: S606


# ------------------------------------------------------------------ infrastructure

def setup_logging(data_dir: Path) -> None:
    logs = data_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    h = logging.handlers.RotatingFileHandler(logs / "guiamhw.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(h)
    if sys.stderr is not None and not getattr(sys, "frozen", False):
        root.addHandler(logging.StreamHandler(sys.stderr))
    if getattr(sys, "frozen", False) or sys.stdout is None or sys.stderr is None:
        class _Stream:
            def write(self, s):
                if s and s.strip():
                    log.info(s.rstrip())
                return len(s or "")

            def flush(self):
                pass

            def isatty(self):
                return False
        sys.stdout = sys.stderr = _Stream()


def _fatal(msg: str) -> int:
    log.error(msg)
    if getattr(sys, "frozen", False):
        winutil.message_box(APP_NAME, msg)
    else:
        print(msg, file=sys.stderr)
    return 1


def _atomic_json(path: Path, data: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    os.replace(tmp, path)


def _read_instance(data_dir: Path) -> dict:
    try:
        d = json.loads((data_dir / "instance.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _focus_running_instance(data_dir: Path) -> None:
    info = _read_instance(data_dir)
    pid, port = info.get("edge_pid"), info.get("port")
    if isinstance(pid, int) and winutil.bring_window_to_front(pid):
        return
    # No token is stored on disk, so we cannot open a working URL: ask the user to close the old window instead.
    msg = ("La aplicación ya se está ejecutando. Cierra su ventana y espera unos segundos antes de volver a "
           "abrirla.")
    log.info("already running and its window was not found")
    if getattr(sys, "frozen", False):
        winutil.message_box(APP_NAME, msg)
    else:
        print(msg, file=sys.stderr)


def _seed_edge_profile(profile: Path) -> None:
    """Disable Edge background mode in our private profile (so closing the window really ends Edge)."""
    from . import safepath
    try:
        profile.mkdir(parents=True, exist_ok=True)
        target = Path(safepath.ensure_writable(profile / "Local State"))
        state = {}
        if target.is_file() and target.stat().st_size <= 4 * 1024 * 1024:
            state = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            state = {}
        if not isinstance(state.get("background_mode"), dict):
            state["background_mode"] = {}
        state["background_mode"]["enabled"] = False
        browser = state.get("browser")
        if isinstance(browser, dict):
            browser.pop("enabled_labs_experiments", None)  # no edge://flags planted into our private profile
        _atomic_json(target, state)
    except (OSError, ValueError, AttributeError, TypeError) as e:  # PermissionError is an OSError
        log.warning("edge profile seed skipped: %s", e)


_LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never route loopback via a proxy


def _http_get(url: str, timeout: float = 5.0, cookie: str | None = None) -> tuple[int, bytes]:
    """GET on loopback; returns (status, body) also for HTTP errors (e.g. 401)."""
    if not url.startswith("http://127.0.0.1:"):
        raise ValueError("loopback only")
    req = urllib.request.Request(url, headers={"Cookie": cookie} if cookie else {})
    try:
        with _LOOPBACK_OPENER.open(req, timeout=timeout) as r:  # noqa: S310 - loopback only, no proxy
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _wait_started(server, timeout: float = 60.0) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if server.started:
            return True
        if server.should_exit:
            return False
        time.sleep(0.1)
    return False


def _edge_watcher(server, port: int, data_dir: Path, instance_path: Path, token: str | None = None) -> None:
    from . import desktop
    try:
        if not _wait_started(server):
            return
        _http_get(f"http://127.0.0.1:{port}/api/health")
        edge = winutil.find_edge()
        popen = None
        if not edge:
            log.warning("msedge.exe not found; opening the default browser")
            open_own_url(port, token)
        else:
            _seed_edge_profile(data_dir / "edge-profile")
            popen = subprocess.Popen(build_edge_argv(edge, port, data_dir, token), shell=False, close_fds=True)
            try:
                info = json.loads(instance_path.read_text(encoding="utf-8"))
                info["edge_pid"] = popen.pid
                _atomic_json(instance_path, info)
            except (OSError, ValueError):
                pass
        started = time.monotonic()
        dog = Watchdog(started)
        handed_off = False
        watch = WindowWatch(started)
        next_poll = started
        while not server.should_exit:
            if popen is None:  # default browser: lenient heartbeat/activity watchdog
                if dog.should_stop(desktop.last_activity()):
                    log.info("no heartbeat or activity; stopping server")
                    break
            elif not handed_off:
                if popen.poll() is not None:
                    if time.monotonic() - started < EDGE_HANDOFF_SECONDS:
                        handed_off = True
                        log.info("Edge exited fast (window handed to another process); watching for the app window")
                    else:
                        log.info("Edge closed; stopping server")
                        break
            elif time.monotonic() >= next_poll:  # window-presence mode; heartbeat is ignored here
                next_poll = time.monotonic() + WINDOW_POLL_SECONDS
                if watch.tick(winutil.has_app_window(APP_NAME)):
                    log.info("stopping server")
                    break
            time.sleep(0.5)
    except Exception:
        log.exception("watcher failed")
    finally:
        server.should_exit = True


def _smoke_worker(server, port: int, result: list) -> None:
    from . import settings
    try:
        if not _wait_started(server):
            raise RuntimeError("server did not start")
        base = f"http://127.0.0.1:{port}"
        cookie = f"mhw_session={settings.SESSION_TOKEN}" if settings.SESSION_TOKEN else None
        checks = [("/api/health", b'"ok"'), ("/api/search?q=rathalos", b"results"), ("/api/stats", b"counts"),
                  ("/api/app/info", VERSION.encode())]
        if settings.WEB_DIST:
            checks.append(("/", b'id="root"'))
            if settings.ICONS_DIR and settings.ICONS_DIR.is_dir():
                icon = next((e.name for e in os.scandir(settings.ICONS_DIR) if e.is_file()), None)
                if icon:
                    checks.append((f"/icons/{icon}", b""))
        for path, needle in checks:
            status, body = _http_get(base + path, 20, cookie)
            if status != 200 or needle not in body:
                raise RuntimeError(f"{path}: status {status}, expected {needle!r}")
        n = len(checks)
        if settings.SESSION_TOKEN:
            status, body = _http_get(base + "/api/stats", 20)
            if status != 401 or settings.SESSION_TOKEN.encode() in body:
                raise RuntimeError(f"/api/stats without cookie: status {status}, expected 401")
            status, _ = _http_get(base + "/api/health", 20)
            if status != 200:
                raise RuntimeError(f"/api/health without cookie: status {status}, expected 200")
            status, _ = _http_get(base + "/api/stats", 20, "mhw_session=wrong")
            if status != 401:
                raise RuntimeError(f"/api/stats with wrong cookie: status {status}, expected 401")
            n += 3
        result.append(f"SMOKE OK ({n} checks)")
    except Exception as e:
        result.append(f"SMOKE FAIL: {e}")
    finally:
        server.should_exit = True


# ------------------------------------------------------------------ main

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="guiamhw", description=APP_NAME)
    ap.add_argument("--no-browser", action="store_true", help="do not open a window")
    ap.add_argument("--smoke", action="store_true", help="self-test without a window")
    ap.add_argument("--port", type=int, help="use only this port (default: first free of 8765-8775)")
    ap.add_argument("--data-dir", help="user data folder")
    args = ap.parse_args(argv)

    frozen = bool(getattr(sys, "frozen", False))
    exe_dir = Path(sys.executable).resolve().parent
    try:
        data_dir = resolve_data_dir(exe_dir, os.environ, args.data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        setup_logging(data_dir)
        if not _writable_dir(data_dir):
            raise StartupError(f"No se puede escribir en la carpeta de datos:\n{data_dir}")
    except StartupError as e:
        return _fatal(str(e))
    except OSError as e:
        return _fatal(f"No se puede crear la carpeta de datos ({e}).")
    os.environ["MHW_USER_DATA_DIR"] = str(data_dir)
    token = secrets.token_urlsafe(32)  # per-launch; must be exported before `app` is imported. Never logged/stored.
    os.environ["MHW_SESSION_TOKEN"] = token

    if not args.smoke and not winutil.acquire_mutex(mutex_name(data_dir)):
        log.info("already running; focusing it")
        _focus_running_instance(data_dir)
        return 0

    if frozen:  # bundled UI/icons if present (set before settings is imported)
        res = Path(getattr(sys, "_MEIPASS", exe_dir))
        for var, sub in (("MHW_WEB_DIST", "web"), ("MHW_ICONS_DIR", "icons")):
            if not os.environ.get(var) and (res / sub).is_dir():
                os.environ[var] = str(res / sub)

    try:
        from . import settings
        if not settings.CATALOG_DB.is_file():
            raise StartupError(f"Falta el catálogo de datos:\n{settings.CATALOG_DB}")
        if args.port is not None and not 1024 <= args.port <= 65535:
            raise StartupError("Puerto no válido (1024-65535).")
        rng = (args.port, args.port) if args.port else (PORT_FIRST, PORT_LAST)
        sock = bind_port("127.0.0.1", *rng)
    except StartupError as e:
        return _fatal(str(e))
    port = sock.getsockname()[1]

    import uvicorn
    from .main import app
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, access_log=False,
                                           http="h11", loop="asyncio", ws="none"))
    instance_path = data_dir / "instance.json"
    result: list[str] = []
    try:
        _atomic_json(instance_path, {"pid": os.getpid(), "port": port, "edge_pid": None})
        if args.smoke:
            threading.Thread(target=_smoke_worker, args=(server, port, result), daemon=True).start()
        elif not args.no_browser:
            threading.Thread(target=_edge_watcher, args=(server, port, data_dir, instance_path, token), daemon=True).start()
        log.info("starting %s %s on 127.0.0.1:%s (data: %s)", APP_NAME, VERSION, port, data_dir)
        server.run(sockets=[sock])
    except Exception as e:
        return _fatal(f"Error al iniciar el servidor: {e}")
    finally:
        try:
            if _read_instance(data_dir).get("pid") == os.getpid():
                instance_path.unlink()
        except OSError:
            pass
    if args.smoke:
        msg = result[0] if result else "SMOKE FAIL: no result"
        print(msg)
        return 0 if msg.startswith("SMOKE OK") else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
