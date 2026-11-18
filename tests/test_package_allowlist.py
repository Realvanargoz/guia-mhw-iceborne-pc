"""Unit tests for scripts/check_package.py with fake trees (no PyInstaller needed)."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_package as cp  # noqa: E402

ALLOW = cp.load_allowlist(ROOT / "scripts" / "package-allowlist.txt")

GOOD = [
    "GuiaMHW.exe", "_internal/base_library.zip", "_internal/python314.dll", "_internal/_ctypes.pyd",
    "_internal/Crypto/Cipher/_raw_aes.pyd", "_internal/catalog.db", "_internal/web/index.html",
    "_internal/web/assets/index-abc.js", "_internal/web/assets/inter-latin-400.woff2",
    "_internal/icons/monsters/1.webp", "_internal/icons/ingredients/ing_goldenfish_brew.webp", "_internal/icons/ui-named/weapon-bow.webp",
    "_internal/research/builds/solo_rules.json", "_internal/research/melder/melder.json",
    "_internal/app/savereader/data/jewels.json",
]


def make(tmp_path, files):
    for f in files:
        p = tmp_path / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    return tmp_path


def test_allowed_tree_passes(tmp_path):
    forb, unexp = cp.check_tree(make(tmp_path, GOOD), ALLOW)
    assert forb == [] and unexp == []


@pytest.mark.parametrize("bad", [
    "_internal/.env", "_internal/research/x.env", "_internal/SAVEDATA1000", "_internal/SAVEDATA1000.copy",
    "_internal/google_oauth_token.json", "_internal/client_secret_1.json", "_internal/a.pem", "_internal/a.key",
    "_internal/notebook_mcp.py", "_internal/x.dump", "_internal/golden/a.json", "_internal/backup/a.db",
    "_internal/data/raw/a.json", "_internal/tools/bin/x.exe", "_internal/a.pdb", "_internal/user.db",
    "_internal/user.db-wal", "_internal/web/assets/a.js.map", "_internal/web/assets/a.woff",
    "_internal/icons/ui/a.webp", "_internal/data/saves/x.bin",
])
def test_forbidden_names_fail(tmp_path, bad):
    forb, _ = cp.check_tree(make(tmp_path, GOOD + [bad]), ALLOW)
    assert any(r == bad for r, _ in forb), forb


def test_unexpected_extra_file_fails(tmp_path):
    _, unexp = cp.check_tree(make(tmp_path, GOOD + ["_internal/research/guides/notes.md",
                                                    "_internal/web/assets/readme.txt", "extra.txt"]), ALLOW)
    assert set(unexp) == {"_internal/research/guides/notes.md", "_internal/web/assets/readme.txt", "extra.txt"}


def test_research_only_runtime_files(tmp_path):
    _, unexp = cp.check_tree(make(tmp_path, ["_internal/research/builds/open_questions.md",
                                             "_internal/research/save_format/a.json"]), ALLOW)
    assert len(unexp) == 2


def test_main_exit_codes(tmp_path):
    make(tmp_path, GOOD)
    assert cp.main([str(tmp_path), "--max-zip-mb", "1"]) == 0
    make(tmp_path, ["_internal/.env"])
    assert cp.main([str(tmp_path)]) == 1


def test_size_budget_fails(tmp_path):
    make(tmp_path, GOOD)
    assert cp.main([str(tmp_path), "--max-zip-mb", "0.000001"]) == 1
