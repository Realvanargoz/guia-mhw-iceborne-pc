import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
RESEARCH_DIR = Path(os.environ.get("RESEARCH_DIR", Path(__file__).resolve().parents[2] / "research"))

RAW_DIR = DATA_DIR / "raw"
REPORTS_DIR = DATA_DIR / "reports"

# MHWorldData (MIT) pinned commit: https://github.com/gatheringhallstudios/MHWorldData
MHWORLDDATA_SHA = "be7362213d7d1e30b794e3b58d3f87712035658d"
MHWORLDDATA_DIR = RAW_DIR / "mhworlddata" / "source_data"

MHWDB_BASE = "https://mhw-db.com"
MHWDB_DIR = RAW_DIR / "mhwdb"

ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT_DIR / "build" / "catalog.db"
CATALOG_VERSION = 1  # also PRAGMA user_version
