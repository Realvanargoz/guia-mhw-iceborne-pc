"""Safety gate for the portable build: allowlist + forbidden patterns + size budget.

    python scripts/check_package.py dist/GuiaMHW [--allowlist scripts/package-allowlist.txt] [--max-zip-mb 45]

Exit code 0 only if (1) no path matches a FORBIDDEN pattern, (2) every file matches the allowlist and
(3) the deflate-9 zipped size of the tree is <= --max-zip-mb. Pure stdlib.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import sys
import tempfile
import zipfile
from pathlib import Path

# Always fatal (matched case-insensitively on the relative posix path, files AND directories).
FORBIDDEN = (
    "*.env", "*.env.*", "*savedata*", "*.copy", "*oauth*", "*client_secret*", "*.pem", "*.key",
    "notebook_mcp*", "*/notebook_mcp*", "*.dump", "golden", "golden/*", "*/golden", "*/golden/*", "*golden.*", "*backup*", "data/raw*", "*/data/raw*",
    "tools/bin*", "*/tools/bin*", "*.pdb", "user.db*", "*/user.db*",
    # size / hygiene guards
    "*.map", "*.woff", "icons/ui/*", "*/icons/ui/*", "*/data/saves*", "*/.config/*", "*steam*",
)


def load_allowlist(path: Path) -> list[str]:
    out = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line.lower())
    return out


def _matches(rel: str, patterns) -> str | None:
    r = rel.lower()
    for p in patterns:
        if fnmatch.fnmatchcase(r, p.lower()):
            return p
    return None


def iter_entries(root: Path):
    """Yield (relposix, is_dir) for everything under root (symlinks are reported, never followed)."""
    for dp, dns, fns in os.walk(root, followlinks=False):
        for n in dns:
            yield (Path(dp, n).relative_to(root).as_posix(), True)
        for n in fns:
            yield (Path(dp, n).relative_to(root).as_posix(), False)


def check_tree(root: Path, allowlist: list[str]) -> tuple[list[tuple[str, str]], list[str]]:
    """Return (forbidden [(path, pattern)], unexpected [path])."""
    forbidden, unexpected = [], []
    for rel, is_dir in iter_entries(Path(root)):
        hit = _matches(rel, FORBIDDEN)
        if hit:
            forbidden.append((rel, hit))
            continue
        if is_dir:
            continue
        if Path(root, rel).is_symlink() or not _matches(rel, allowlist):
            unexpected.append(rel)
    return forbidden, unexpected


def size_table(root: Path) -> dict[str, int]:
    tot: dict[str, int] = {}
    for rel, is_dir in iter_entries(Path(root)):
        if is_dir:
            continue
        top = rel.split("/")[0] if "/" in rel else "(root files)"
        if rel.startswith("_internal/") and rel.count("/") >= 2:
            top = "/".join(rel.split("/")[:2])
        tot[top] = tot.get(top, 0) + Path(root, rel).stat().st_size
    return dict(sorted(tot.items(), key=lambda kv: -kv[1]))


def biggest(root: Path, n: int = 30) -> list[tuple[int, str]]:
    files = [(Path(root, rel).stat().st_size, rel) for rel, d in iter_entries(Path(root)) if not d]
    return sorted(files, reverse=True)[:n]


def zipped_size(root: Path) -> int:
    root = Path(root)
    with tempfile.TemporaryDirectory() as td:
        zp = Path(td) / "t.zip"
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for rel, d in iter_entries(root):
                if not d:
                    z.write(root / rel, rel)
        return zp.stat().st_size


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dist")
    ap.add_argument("--allowlist", default=str(Path(__file__).with_name("package-allowlist.txt")))
    ap.add_argument("--max-zip-mb", type=float, default=45.0)
    a = ap.parse_args(argv)
    root = Path(a.dist)
    if not root.is_dir():
        print(f"FAIL: {root} is not a directory")
        return 2
    forbidden, unexpected = check_tree(root, load_allowlist(Path(a.allowlist)))
    print("== size per top-level folder ==")
    for k, v in size_table(root).items():
        print(f"  {v / 1e6:9.2f} MB  {k}")
    print("== 30 biggest files ==")
    for sz, rel in biggest(root):
        print(f"  {sz / 1e6:9.2f} MB  {rel}")
    ok = True
    for rel, pat in forbidden:
        print(f"FORBIDDEN: {rel}  (matches {pat})")
        ok = False
    for rel in unexpected:
        print(f"NOT IN ALLOWLIST: {rel}")
        ok = False
    zs = zipped_size(root)
    print(f"zipped size (deflate 9): {zs / 1e6:.2f} MB (limit {a.max_zip_mb} MB)")
    if zs > a.max_zip_mb * 1e6:
        print("FAIL: zip over budget")
        ok = False
    print("PACKAGE CHECK:", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
