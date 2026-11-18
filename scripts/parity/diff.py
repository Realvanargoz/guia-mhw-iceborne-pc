#!/usr/bin/env python3
"""Compare two capture dirs (from capture.py). Exit 1 on differences.

  python scripts/parity/diff.py build/golden/pg build/golden/pg2 [--allowlist tests/parity/allowlist.json] [--strict-search]
"""
import argparse
import re, fnmatch, json, os, re, sys, unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAX_LINES = 40


def load_dir(d):
    with open(os.path.join(d, "index.json"), encoding="utf-8") as f:
        idx = json.load(f)
    out = {}
    for e in idx["entries"]:
        with open(os.path.join(d, e["file"]), encoding="utf-8") as f:
            out[e["key"]] = json.load(f)
    return out


def norm_path(p):
    return re.sub(r"\[\d+\]", "[*]", p)


class Differ:
    def __init__(self, allow):
        self.fields = set(allow.get("ignore_fields", []))
        self.paths = allow.get("ignore_paths", [])
        self.unordered = allow.get("unordered_paths", [])
        self.out = []
        self.tiecut = []  # búsquedas cuyo LIMIT corta un grupo empatado: Postgres no define cuáles entran

    def ignored(self, key, path):
        np = norm_path(path)
        for rule in self.paths:
            if fnmatch.fnmatchcase(key, rule["endpoint"]):
                for pat in rule["paths"]:
                    pat = pat.replace("[*]", "[[]*[]]")  # fnmatch: '[' literal
                    if pat == "$" and path == "$" or fnmatch.fnmatchcase(np, pat) or fnmatch.fnmatchcase(path, pat):
                        return True
        return False

    def is_unordered(self, key, path):
        np = norm_path(path)
        for rule in self.unordered:
            if fnmatch.fnmatchcase(key, rule["endpoint"]):
                for pat in rule["paths"]:
                    pat = pat.replace("[*]", "[[]*[]]")
                    if fnmatch.fnmatchcase(np, pat):
                        return True
        return False

    def add(self, key, path, msg):
        self.out.append((key, path, msg))

    def cmp(self, key, a, b, path="$"):
        if self.ignored(key, path):
            return
        if isinstance(a, bool) or isinstance(b, bool):
            if a is not b:
                self.add(key, path, f"{short(a)} != {short(b)}")
        elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
            if a != b and not (abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))):
                self.add(key, path, f"{a} != {b}")
        elif isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b)):
                if k in self.fields:
                    continue
                p = f"{path}.{k}"
                if k not in a:
                    if not self.ignored(key, p):
                        self.add(key, p, "missing in A")
                elif k not in b:
                    if not self.ignored(key, p):
                        self.add(key, p, "missing in B")
                else:
                    self.cmp(key, a[k], b[k], p)
        elif isinstance(a, list) and isinstance(b, list):
            if self.is_unordered(key, path):
                canon = lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False)
                a, b = sorted(a, key=canon), sorted(b, key=canon)
            if len(a) != len(b):
                self.add(key, path, f"len {len(a)} != {len(b)}")
            for i, (x, y) in enumerate(zip(a, b)):
                self.cmp(key, x, y, f"{path}[{i}]")
        elif type(a) is not type(b) or a != b:
            self.add(key, path, f"{short(a)} != {short(b)}")


def short(v):
    s = json.dumps(v, ensure_ascii=False, sort_keys=True)
    return s if len(s) <= 60 else s[:57] + "..."


def fnorm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()


def search_groups(q, rows):
    """Group consecutive rows by observable rank key (prefix, contains, type); scores are not exposed."""
    nq = fnorm(q)
    groups, last = [], None
    for r in rows:
        es, en = fnorm(r.get("name_es")), fnorm(r.get("name_en"))
        doc = (es + " " + en).strip()
        k = (es.startswith(nq) or en.startswith(nq), nq in doc, r.get("type"))
        if k != last:
            groups.append((k, []))
            last = k
        groups[-1][1].append(json.dumps(r, sort_keys=True, ensure_ascii=False))
    return groups


def cmp_search(d, key, a, b, strict):
    n0 = len(d.out)
    _cmp_search(d, key, a, b, strict)
    if strict or len(d.out) == n0:
        return
    m = re.search(r"[?&]limit=(\d+)", key)
    lim = int(m.group(1)) if m else 40
    if len(a.get("results", [])) >= lim and len(b.get("results", [])) >= lim and a.get("q") == b.get("q"):
        d.tiecut.append(key)
        del d.out[n0:]


def _cmp_search(d, key, a, b, strict):
    ra, rb = a.get("results", []), b.get("results", [])
    for f in ("q",):
        if a.get(f) != b.get(f):
            d.add(key, f"$.{f}", f"{short(a.get(f))} != {short(b.get(f))}")
    if strict:
        d.cmp(key, ra, rb, "$.results")
        return
    q = a.get("q", "")
    ga, gb = search_groups(q, ra), search_groups(q, rb)
    if [g[0] for g in ga] != [g[0] for g in gb] or [len(g[1]) for g in ga] != [len(g[1]) for g in gb]:
        d.add(key, "$.results", f"group layout differs: A={[(g[0][2], len(g[1])) for g in ga][:6]} B={[(g[0][2], len(g[1])) for g in gb][:6]}")
        return
    pos = 0
    for (k, ia), (_, ib) in zip(ga, gb):
        if sorted(ia) != sorted(ib):
            only_a = sorted(set(ia) - set(ib))
            only_b = sorted(set(ib) - set(ia))
            ident = lambda s: (lambda o: f"{o['type']}:{o['id']}")(json.loads(s))
            d.add(key, f"$.results[{pos}..{pos + len(ia) - 1}]",
                  f"tie-group {k[2]} set differs; onlyA={[ident(x) for x in only_a][:4]} onlyB={[ident(x) for x in only_b][:4]}")
        pos += len(ia)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--allowlist", default=os.path.join(ROOT, "tests", "parity", "allowlist.json"))
    ap.add_argument("--strict-search", action="store_true", help="require exact search order")
    ap.add_argument("--max-lines", type=int, default=MAX_LINES)
    args = ap.parse_args()
    with open(args.allowlist, encoding="utf-8") as f:
        allow = json.load(f)
    A, B = load_dir(args.a), load_dir(args.b)
    d = Differ(allow)
    for k in sorted(set(A) | set(B)):
        if k not in A or k not in B:
            d.add(k, "$", "request missing in " + ("A" if k not in A else "B"))
            continue
        ra, rb = A[k], B[k]
        if ra["status"] != rb["status"]:
            d.add(k, "$.status", f"{ra['status']} != {rb['status']}")
            continue
        if k.startswith("GET /api/search?") and ra["status"] == 200:
            cmp_search(d, k, ra["body"], rb["body"], args.strict_search)
        else:
            d.cmp(k, ra["body"], rb["body"])
    n_bad = len({x[0] for x in d.out})
    print(f"compared {len(set(A) | set(B))} requests; {n_bad} differ, {len(d.out)} differences; {len(d.tiecut)} searches differ only by LIMIT cutting a tie group (allowed)")
    for key, path, msg in d.out[:args.max_lines]:
        print(f"{key[:70]} {path[:60]}: {msg[:110]}")
    if len(d.out) > args.max_lines:
        print(f"... {len(d.out) - args.max_lines} more")
    return 1 if d.out else 0


if __name__ == "__main__":
    sys.exit(main())
