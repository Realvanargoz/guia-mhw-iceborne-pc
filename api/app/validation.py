"""Shared input validation: bounded text without control characters, id patterns and pagination caps.

Text is stored and returned as data only (the web app never renders it as HTML), but control characters
(NUL, escape sequences, bidi tricks) are rejected anyway.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Query
from pydantic import AfterValidator, StringConstraints

MAX_QUERY_LEN = 100       # free-text search `q`
MAX_TITLE_LEN = 120
MAX_NOTE_LEN = 2000
MAX_FILTER_LEN = 40       # category / rank / type / kind ... filters
MAX_LIMIT = 2000          # absolute pagination cap
ID_PATTERN = r"^[\w.'\-]{1,80}$"   # slugs, ing_*, numeric ids

# C0/C1 controls (except \t \n \r), DEL, line/paragraph separators and bidi override/isolate characters.
_BAD_CODEPOINTS = frozenset([
    *range(0x00, 0x09), 0x0B, 0x0C, *range(0x0E, 0x20),   # C0 controls, keeping \t (09), \n (0A), \r (0D)
    *range(0x7F, 0xA0),                                      # DEL + C1 controls
    0x2028, 0x2029,                                          # line / paragraph separators
    *range(0x202A, 0x202F), *range(0x2066, 0x206A),          # bidi embeddings, overrides and isolates
])


def no_control_chars(v: str) -> str:
    if any(ord(ch) in _BAD_CODEPOINTS for ch in v):
        raise ValueError("Caracteres de control no permitidos")
    return v


Title = Annotated[str, StringConstraints(max_length=MAX_TITLE_LEN), AfterValidator(no_control_chars)]
Note = Annotated[str, StringConstraints(max_length=MAX_NOTE_LEN), AfterValidator(no_control_chars)]  # \n, \t, \r allowed
Slug = Annotated[str, StringConstraints(pattern=ID_PATTERN)]


def filter_q(default=None):
    """Optional short filter string (category, rank, type...)."""
    return Query(default, max_length=MAX_FILTER_LEN, pattern=r"^[^\x00-\x1f\x7f]*$")


def text_q(default=None, **kw):
    """Free-text search query: <=100 chars, no control chars."""
    return Query(default, max_length=MAX_QUERY_LEN, pattern=r"^[^\x00-\x08\x0b-\x1f\x7f]*$", **kw)


def limit_q(default: int, maximum: int = MAX_LIMIT):
    return Query(default, ge=1, le=maximum)
