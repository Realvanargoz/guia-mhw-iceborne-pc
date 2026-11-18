# Text-search parity fixtures

All files are produced from the live PostgreSQL 17 database (docker compose `db`, read-only SELECTs) by

    python scripts/gen_fnorm_table.py fixtures     # `table` regenerates api/app/_fnorm_table.py, `all` does both

The random parts use a fixed seed, but the output depends on the catalog contents. If the catalog changes, regenerate.

| file | content | checked by |
|---|---|---|
| `fnorm.json` | `pairs`: `[x, public.f_norm(x)]` for every distinct `name_es`/`name_en`/`subtitle` in `mhw.search_index`, tricky characters and random Unicode. `like`: `[value, pattern, value LIKE pattern]` | `tests/test_textnorm.py` |
| `trgm_pairs.json` | `pairs`: `[a, b, word_similarity(a,b)::text, word_similarity(a,b)::float8, similarity(a,b)::text, similarity(a,b)::float8, a <% b]`. `::float8` is the exact float4 value, `::text` is what psycopg gives Python | `tests/test_trgm.py` |
| `search_golden.json` | for 46 `/api/search` cases: the rows returned by the current SQL in `api/app/main.py` (`sql_rows`: type, id, score, prefix, contains, name_es, name_en) and the final API order after main.py's Python re-sort (`api_ids`) | `tests/test_trgm.py` (row attributes); the in-memory search step (order) |

`search_golden.json` caveat: the SQL `ORDER BY prefix, contains, score, length(...)` has no unique tie-breaker. Postgres
does not define the order of rows that tie on all four keys, and `LIMIT limit*3` can cut through such a group. Compare
tie groups as sets, not by position.

Transport note: query results come back base64-encoded, because psql's output printer silently drops code points it
won't display (the noncharacters U+1FFFE, U+1FFFF ... U+10FFFF). The server itself keeps them.
