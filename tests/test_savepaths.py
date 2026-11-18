import hashlib
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app import safepath, savepaths, settings  # noqa: E402

BODY = b"x" * 4096


@pytest.fixture
def env(tmp_path, monkeypatch):
    steam = tmp_path / "Steam"
    (steam / "appcache" / "stats").mkdir(parents=True)
    user = tmp_path / "userdata_app"
    user.mkdir()
    monkeypatch.setattr(savepaths.sys, "platform", "win32")
    monkeypatch.setattr(savepaths, "_read_registry_steam_path", lambda: str(steam))
    monkeypatch.setattr(settings, "USER_DATA_DIR", user)
    monkeypatch.setattr(settings, "SAVE_STORE", str(tmp_path / "store"))
    return steam, user, tmp_path


def make_save(steam, acct, mtime, body=BODY):
    d = steam / "userdata" / acct / "582010" / "remote"
    d.mkdir(parents=True)
    f = d / "SAVEDATA1000"
    f.write_bytes(body)
    os.utime(f, (mtime, mtime))
    return f


def snapshot(root):
    out = {}
    for p in sorted(Path(root).rglob("*")):
        if p.is_file():
            st = p.stat()
            out[str(p)] = (hashlib.sha256(p.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns)
    return out


def test_steam_root_none_off_windows(monkeypatch):
    monkeypatch.setattr(savepaths.sys, "platform", "linux")
    assert savepaths.steam_root() is None
    assert savepaths.find_saves() == []


def test_ordering_by_mtime(env):
    steam, _, _ = env
    make_save(steam, "111", 1_700_000_000)
    make_save(steam, "222", 1_800_000_000)
    make_save(steam, "333", 1_750_000_000)
    c = savepaths.find_saves()
    assert [x["account_id"] for x in c] == ["222", "333", "111"]
    assert c[0]["size"] == len(BODY)
    assert c[0]["path"].endswith(os.path.join("222", "582010", "remote", "SAVEDATA1000"))
    r = savepaths.resolve(str(env[2] / "nomount"))
    assert r["source"] == "auto" and r["account_id"] == "222"


def test_find_stats(env):
    steam, _, _ = env
    d = steam / "appcache" / "stats"
    (d / "UserGameStats_222_582010.bin").write_bytes(b"a")
    (d / "UserGameStatsSchema_582010.bin").write_bytes(b"b")
    f, s = savepaths.find_stats("222")
    assert f.endswith("UserGameStats_222_582010.bin") and s.endswith("UserGameStatsSchema_582010.bin")
    assert savepaths.find_stats("999")[0] is None
    assert savepaths.find_stats(None)[0] is not None


def test_validation_rejects(env):
    steam, _, tmp = env
    good = make_save(steam, "111", 1_700_000_000)
    assert savepaths.validate_save_file(str(good))
    other = tmp / "SAVEDATA1001"
    other.write_bytes(BODY)
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(other))
    d = tmp / "adir" / "SAVEDATA1000"
    d.mkdir(parents=True)
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(d))
    big = tmp / "big" / "SAVEDATA1000"
    big.parent.mkdir()
    with open(big, "wb") as f:
        f.truncate(savepaths.MAX_SAVE_BYTES + 1)
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(big))
    small = tmp / "small" / "SAVEDATA1000"
    small.parent.mkdir()
    small.write_bytes(b"x")
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(small))
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(tmp / "adir" / ".." / "Steam" / "SAVEDATA1000"))
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file("relative/SAVEDATA1000")
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(good) + "x" * 400)


def test_validation_rejects_symlink(env):
    steam, _, tmp = env
    good = make_save(steam, "111", 1_700_000_000)
    link = tmp / "lnk" / "SAVEDATA1000"
    link.parent.mkdir()
    try:
        os.symlink(good, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not permitted here")
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(link))
    dlink = tmp / "dl"
    try:
        os.symlink(good.parent, dlink, target_is_directory=True)
    except (OSError, NotImplementedError):
        return
    with pytest.raises(savepaths.SavePathError):
        savepaths.validate_save_file(str(dlink / "SAVEDATA1000"))


def test_override_persisted_atomically_and_precedence(env, monkeypatch):
    steam, user, tmp = env
    make_save(steam, "111", 1_800_000_000)
    older = make_save(steam, "222", 1_700_000_000)
    replaced = []
    real_replace = os.replace
    monkeypatch.setattr(savepaths.os, "replace", lambda a, b: (replaced.append((a, b)), real_replace(a, b))[1])
    savepaths.set_override(str(older))
    assert replaced and replaced[0][0].endswith(".tmp") and replaced[0][1].endswith("settings.json")
    data = json.loads((user / "settings.json").read_text(encoding="utf-8"))
    assert data["save_path"] == str(older)
    assert not (user / "settings.json.tmp").exists()
    r = savepaths.resolve(str(tmp / "nomount"))
    assert r["source"] == "override" and r["account_id"] == "222" and len(r["candidates"]) == 2
    # mount wins over override
    mnt = tmp / "mnt"
    mnt.mkdir()
    (mnt / "SAVEDATA1000").write_bytes(BODY)
    assert savepaths.resolve(str(mnt))["source"] == "mount"
    # invalid value is rejected and does not alter the file
    with pytest.raises(savepaths.SavePathError):
        savepaths.set_override(str(tmp / "SAVEDATA1001"))
    assert json.loads((user / "settings.json").read_text(encoding="utf-8"))["save_path"] == str(older)
    savepaths.set_override(None)
    assert "save_path" not in json.loads((user / "settings.json").read_text(encoding="utf-8"))
    assert savepaths.resolve(str(tmp / "nomount"))["source"] == "auto"


def test_settings_write_confined_to_user_data(env, monkeypatch):
    steam, user, tmp = env
    good = make_save(steam, "111", 1_700_000_000)
    monkeypatch.setattr(savepaths, "_settings_file", lambda: str(steam / "settings.json"))
    with pytest.raises(PermissionError):
        savepaths.set_override(str(good))
    assert not (steam / "settings.json").exists()
    assert safepath.ensure_writable(user / "settings.json")


def test_detection_is_read_only(env):
    steam, user, tmp = env
    make_save(steam, "111", 1_700_000_000)
    make_save(steam, "222", 1_800_000_000)
    (steam / "appcache" / "stats" / "UserGameStats_222_582010.bin").write_bytes(b"s")
    (steam / "appcache" / "stats" / "UserGameStatsSchema_582010.bin").write_bytes(b"c")
    before = snapshot(steam)
    dirs_before = sorted(str(p) for p in steam.rglob("*"))
    savepaths.steam_root()
    savepaths.find_saves()
    savepaths.find_stats("222")
    savepaths.find_stats(None)
    savepaths.resolve(str(tmp / "nomount"))
    savepaths.validate_save_file(str(steam / "userdata" / "222" / "582010" / "remote" / "SAVEDATA1000"))
    assert snapshot(steam) == before
    assert sorted(str(p) for p in steam.rglob("*")) == dirs_before
