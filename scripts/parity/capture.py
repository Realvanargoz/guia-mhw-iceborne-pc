#!/usr/bin/env python3
"""Capture API responses (GET + read-only evaluate POST) into one JSON file per request.

  python scripts/parity/capture.py --base http://localhost:8000 --out build/golden/pg --header "X-MHW-Client: 1"
"""
import argparse, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
READONLY_POSTS = {"/api/builds/evaluate"}  # pure computation, verified not to write


def load_requests(endpoints, searches):
    reqs = []
    with open(endpoints, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if not line.strip() or line.startswith("#"):
                continue
            if line.startswith("POST "):
                _, path, body = line.split(" ", 2)
                if path not in READONLY_POSTS:
                    sys.exit(f"refusing POST to {path}")
                reqs.append(("POST", path, body))
            else:
                reqs.append(("GET", line.strip(), None))
    with open(searches, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if line.startswith("#") or not line:
                continue
            q, typ, lim = line.rsplit("|", 2) if line.count("|") >= 2 else (line, "", "")
            params = [("q", q)]
            if typ:
                params.append(("type", typ))
            if lim:
                params.append(("limit", lim))
            reqs.append(("GET", "/api/search?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote), None))
    return reqs


def fetch(base, method, path, body, headers, timeout=20, retries=3):
    data = body.encode("utf-8") if body is not None else None
    hdrs = dict(headers)
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(base + path, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
            if status in (502, 503, 504) and attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1)); continue
        except Exception as e:  # network / timeout
            last = repr(e)
            time.sleep(0.5 * (attempt + 1))
            continue
        text = raw.decode("utf-8", "replace")
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed = {"_non_json": text[:2000]}
        return status, parsed
    return -1, {"_error": last}


def fname(i, method, path):
    slug = re.sub(r"[^A-Za-z0-9]+", "_", path)[:60].strip("_")
    h = hashlib.sha1((method + " " + path).encode()).hexdigest()[:8]
    return f"{i:04d}_{method}_{slug}_{h}.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--out", required=True)
    ap.add_argument("--header", action="append", default=[])
    ap.add_argument("--endpoints", default=os.path.join(ROOT, "tests", "parity", "endpoints.txt"))
    ap.add_argument("--searches", default=os.path.join(ROOT, "tests", "parity", "search_queries.txt"))
    ap.add_argument("--concurrency", type=int, default=4)
    a = ap.parse_args()
    headers = {}
    for h in a.header:
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()
    base = a.base.rstrip("/")
    reqs = load_requests(a.endpoints, a.searches)
    os.makedirs(a.out, exist_ok=True)
    for old in os.listdir(a.out):
        if old.endswith(".json"):
            os.remove(os.path.join(a.out, old))

    def work(item):
        i, (method, path, body) = item
        t0 = time.time()
        status, parsed = fetch(base, method, path, body, headers)
        fn = fname(i, method, path)
        rec = {"key": f"{method} {path}", "method": method, "path": path, "status": status, "body": parsed}
        if body is not None:
            rec["request_body"] = json.loads(body)
        with open(os.path.join(a.out, fn), "w", encoding="utf-8", newline="\n") as f:
            json.dump(rec, f, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return {"key": rec["key"], "file": fn, "status": status, "ms": round((time.time() - t0) * 1000)}

    with ThreadPoolExecutor(a.concurrency) as ex:
        index = list(ex.map(work, enumerate(reqs)))
    with open(os.path.join(a.out, "index.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"base": base, "count": len(index), "entries": index}, f, indent=1, ensure_ascii=False)
    from collections import Counter
    c = Counter(e["status"] for e in index)
    print(f"captured {len(index)} requests -> {a.out}; status counts: {dict(sorted(c.items()))}")
    return 1 if c.get(-1) else 0


if __name__ == "__main__":
    sys.exit(main())
