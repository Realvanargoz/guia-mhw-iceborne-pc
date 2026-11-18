"""Guard against leftover Postgres syntax in the SQLite data layer.

Scans the SQL strings in api/app/*.py, except validation.py, for Postgres-only constructs. A string counts as
SQL when it is an argument of a db call (all_, one, one_or_404, execute, ...), starts with a SQL verb, or
starts with a SQL clause keyword (a fragment of a longer query). Docstrings, comments and messages are not
scanned. Only the standard library is used, so the test runs without importing the app.
Legitimate uses go in ALLOW, keyed by (file name, pattern name), with the reason.
"""
import ast
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "api" / "app"
EXCLUDED = {"validation.py"}

PATTERNS = {
    "%s": re.compile(r"%s"),
    "%(": re.compile(r"%\("),
    "::": re.compile(r"::"),
    "ANY(": re.compile(r"(?i)\bANY\s*\("),
    "jsonb": re.compile(r"(?i)\bjsonb\b"),
    " @> ": re.compile(r" @> "),
    "array_agg": re.compile(r"(?i)\barray_agg\b"),
    "array_position": re.compile(r"(?i)\barray_position\b"),
    "DISTINCT ON": re.compile(r"(?i)\bDISTINCT\s+ON\b"),
    "string_agg": re.compile(r"(?i)\bstring_agg\b"),
    "public.": re.compile(r"(?i)\bpublic\."),
    "mhw.": re.compile(r"(?i)\bmhw\."),
    "psycopg": re.compile(r"(?i)psycopg"),
    "now()": re.compile(r"(?i)\bnow\(\)"),
    "ILIKE": re.compile(r"(?i)\bILIKE\b"),
    "generate_series": re.compile(r"(?i)\bgenerate_series\b"),
    "interval": re.compile(r"(?i)\binterval\b"),
}

# (file name, pattern name) -> reason the construct is legitimate there.
ALLOW: dict[tuple[str, str], str] = {}

SQL_CALLS = {"all_", "one", "one_or_404", "execute", "executemany", "executescript"}
SQL_VERB = re.compile(r"(?i)^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|PRAGMA)\b")
SQL_CLAUSE = re.compile(r"^\s*(FROM|WHERE|JOIN|LEFT JOIN|INNER JOIN|ORDER BY|GROUP BY|ON CONFLICT|RETURNING|VALUES|SET|LIMIT|HAVING)\b")


def _sql_ids(tree: ast.AST) -> set[int]:
    """ids of string nodes that sit inside the first argument of a db call."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name in SQL_CALLS:
            for sub in ast.walk(node.args[0]):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                    ids.add(id(sub))
    return ids


def _violations(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    sql_ids = _sql_ids(tree)
    found = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        text = node.value
        if not (id(node) in sql_ids or SQL_VERB.match(text) or SQL_CLAUSE.match(text)):
            continue
        for name, rx in PATTERNS.items():
            if (path.name, name) in ALLOW:
                continue
            for m in rx.finditer(text):
                line = node.lineno + text.count("\n", 0, m.start())
                snippet = text[max(0, m.start() - 30):m.end() + 30]
                shown = path.relative_to(APP.parents[1]) if path.is_relative_to(APP.parents[1]) else path
                found.append(f"{shown}:{line}: {name!r} in {snippet!r}")
    return found


def _files() -> list[Path]:
    return sorted(p for p in APP.glob("*.py") if p.name not in EXCLUDED)


def test_scan_finds_app_files():
    assert _files(), f"no files found under {APP}"


@pytest.mark.parametrize("path", _files(), ids=lambda p: p.name)
def test_no_postgres_syntax(path):
    found = _violations(path)
    assert not found, "Postgres-only syntax left in SQL strings:\n" + "\n".join(found)


def test_allow_list_entries_are_known():
    names = {p.name for p in APP.glob("*.py")}
    for (fname, pattern), reason in ALLOW.items():
        assert fname in names, f"ALLOW refers to a missing file: {fname}"
        assert pattern in PATTERNS, f"ALLOW refers to an unknown pattern: {pattern}"
        assert reason.strip(), f"ALLOW entry {fname}/{pattern} needs a reason"
