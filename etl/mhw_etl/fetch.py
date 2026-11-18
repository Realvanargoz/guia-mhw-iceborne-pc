"""Download the raw source data into DATA_DIR/raw (idempotent)."""
import io
import json
import tarfile
import urllib.parse
import urllib.request

from . import config

UA = {"User-Agent": "mhw-guide-etl/1.0"}


def _get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_mhworlddata(refresh: bool = False) -> None:
    marker = config.MHWORLDDATA_DIR.parent / "COMMIT"
    if not refresh and marker.exists() and marker.read_text().strip() == config.MHWORLDDATA_SHA:
        print(f"[fetch] MHWorldData {config.MHWORLDDATA_SHA[:8]} already present")
        return
    url = f"https://codeload.github.com/gatheringhallstudios/MHWorldData/tar.gz/{config.MHWORLDDATA_SHA}"
    print(f"[fetch] downloading MHWorldData {config.MHWORLDDATA_SHA[:8]} ...")
    blob = _get(url, timeout=300)
    target = config.MHWORLDDATA_DIR.parent
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        members = []
        for m in tar.getmembers():
            parts = m.name.split("/", 1)
            if len(parts) == 2 and parts[1].startswith("source_data/") and (m.isfile() or m.isdir()):
                m.name = parts[1]
                members.append(m)
        tar.extractall(target, members=members, filter="data")
    marker.write_text(config.MHWORLDDATA_SHA)
    print(f"[fetch] extracted {len(members)} entries")


def fetch_mhwdb(refresh: bool = False) -> None:
    config.MHWDB_DIR.mkdir(parents=True, exist_ok=True)
    targets = {
        "locations.json": "/locations",
        "events.json": "/events",
        "armor.json": "/armor?p=" + urllib.parse.quote(json.dumps({"id": True, "name": True, "rank": True, "assets": True})),
    }
    for fname, path in targets.items():
        out = config.MHWDB_DIR / fname
        if out.exists() and not refresh:
            print(f"[fetch] mhw-db {fname} already present")
            continue
        print(f"[fetch] mhw-db {path}")
        data = json.loads(_get(config.MHWDB_BASE + path))
        out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def fetch_all(refresh: bool = False) -> None:
    fetch_mhworlddata(refresh)
    fetch_mhwdb(refresh)
