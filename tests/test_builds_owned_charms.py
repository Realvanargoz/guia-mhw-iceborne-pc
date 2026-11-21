"""Con owned=1 el recomendador solo propone amuletos presentes en el save (equipment.charms).

user.db temporal con un snapshot falso; catalog.db del repo en solo lectura. No toca la instalacion del usuario.
Run: python -m pytest tests/test_builds_owned_charms.py -q
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
LARGE_MONSTER = 17  # Great Jagras

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import builds, db, settings, userdb  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("owned_charms") / "user.db"
    userdb.migrate(user)
    db.close_pool()
    db.open_pool(user, CATALOG)
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "SESSION_TOKEN", None)
    try:
        with TestClient(app, base_url="http://127.0.0.1") as c:
            yield c
    finally:
        mp.undo()
        db.close_pool()


def _snapshot(armor, charms):
    data = {"signature_ok": True, "slots": [{"slot": 1, "equipment": {
        "armor": [{"name_en": n, "count": 1} for n in armor],
        "charms": [{"name_en": n, "count": 1} for n in charms]}, "decorations": []}]}
    db.execute("INSERT INTO profile_snapshots (taken_at, source, sha256, slot, data) VALUES (?, ?, ?, ?, ?)",
               (db.now(), "upload", "x" * 64, 1, db.J(data)))
    builds.reset_cache()


def _catalog():
    D = builds._load()
    armor = [a["name_en"] for a in D["armor"].values() if 5 <= (a["rarity"] or 0) <= 8][:200]
    charms = sorted(D["charms"].values(), key=lambda c: c["id"])
    return D, armor, charms


def _charm_ids(body):
    return {(b["charm"] or {}).get("id") for b in body["builds"]}


def test_only_owned_charm_is_proposed(client):
    D, armor, charms = _catalog()
    free = client.get(f"/api/builds/monster/{LARGE_MONSTER}", params={"rank": "HR", "cap": "full"}).json()
    generic = {c for c in _charm_ids(free) if c}
    # an owned charm that the unrestricted search does not pick, so the restriction is observable
    other = next(c for c in charms if c["id"] not in generic and c["rarity"] <= 8)
    _snapshot(armor, [other["name_en"]])
    r = client.get(f"/api/builds/monster/{LARGE_MONSTER}", params={"rank": "HR", "cap": "full", "owned": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owned_available"] is True
    assert _charm_ids(body) <= {None, other["id"]}
    assert any("Solo se proponen amuletos que tienes" in n for n in body["notes"])
    assert not any("no incluye amuletos" in n for n in body["notes"])


def test_no_owned_charms_means_no_charm(client):
    _, armor, _ = _catalog()
    _snapshot(armor, [])  # newest snapshot (highest id) wins, same as the profile endpoints
    body = client.get(f"/api/builds/monster/{LARGE_MONSTER}", params={"rank": "HR", "cap": "full", "owned": 1}).json()
    assert _charm_ids(body) <= {None}
    assert all(b["charm"] is None for b in body["builds"])
