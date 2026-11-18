"""Pure-Python, bit-exact replacements for the Postgres text helpers used by the API search.

* ``f_norm(text)``  ==  ``public.f_norm(text)`` = ``lower(unaccent('public.unaccent', $1))`` on the project's
  PostgreSQL 17 (Alpine/musl, UTF8, libc provider, ctype en_US.utf8).
* ``like(value, pattern)`` == ``value LIKE pattern`` (default escape ``\\``, deterministic collation).
* ``contains(value, needle)`` == ``value LIKE '%' || needle || '%'``;
  ``startswith(value, needle)`` == ``value LIKE needle || '%'`` (``needle`` is NOT escaped: ``%``, ``_`` and ``\\``
  inside it keep their LIKE meaning, exactly like the SQL in ``main.py``).

Why a per-code-point table is exact: every source in ``unaccent.rules`` is a single code point (checked by
``scripts/gen_fnorm_table.py``), so unaccent's longest-match trie never spans two characters, and Postgres'
``lower()`` maps each wide char with ``towlower`` 1:1. Hence ``f_norm(s) == ''.join(f_norm(c) for c in s)`` and the
table (generated from the live database for every code point 1..0x10FFFF) is the whole function.
"""
from __future__ import annotations

import re
from functools import lru_cache

from ._fnorm_table import FNORM

__all__ = ["f_norm", "like", "contains", "startswith"]


def f_norm(text: str | None) -> str | None:
    """Exact port of ``public.f_norm(text)``; ``None`` in -> ``None`` out (the SQL function is STRICT)."""
    if text is None:
        return None
    if text.isascii():
        # The only ASCII entries in the table are A-Z -> a-z (asserted by the generator), i.e. str.lower().
        return text.lower()
    return text.translate(FNORM)


# --------------------------------------------------------------------------------------------- LIKE

_LIKE_SPECIAL = frozenset("%_\\")


@lru_cache(maxsize=4096)
def _like_regex(pattern: str) -> re.Pattern:
    out = []
    i, n = 0, len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\":
            i += 1
            if i >= n:
                # Postgres raises this lazily (only if matching reaches the escape); we raise eagerly.
                # Unreachable from main.py: its patterns always end with '%'.
                raise ValueError("LIKE pattern must not end with escape character")
            out.append(re.escape(pattern[i]))
        elif ch == "%":
            if not out or out[-1] != ".*":   # '%%' == '%'
                out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(re.escape(ch))
        i += 1
    return re.compile("".join(out), re.DOTALL)


def like(value: str | None, pattern: str | None) -> bool | None:
    """``value LIKE pattern`` with Postgres semantics: case-sensitive, ``%`` = any run of characters,
    ``_`` = exactly one character (code point), ``\\x`` = literal ``x``. NULL in -> ``None``."""
    if value is None or pattern is None:
        return None
    return _like_regex(pattern).fullmatch(value) is not None


def contains(value: str | None, needle: str | None) -> bool | None:
    """``value LIKE '%' || needle || '%'`` (needle unescaped, as in main.py)."""
    if value is None or needle is None:
        return None
    if _LIKE_SPECIAL.isdisjoint(needle):
        return needle in value
    return like(value, "%" + needle + "%")


def startswith(value: str | None, needle: str | None) -> bool | None:
    """``value LIKE needle || '%'`` (needle unescaped, as in main.py)."""
    if value is None or needle is None:
        return None
    if _LIKE_SPECIAL.isdisjoint(needle):
        return value.startswith(needle)
    return like(value, needle + "%")
