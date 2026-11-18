"""python -m app.savereader <file>

Parses the save in-process and prints only a content-free summary (ok flag, file size, slot count, timing) as JSON.
Exit codes as the .NET tool: 0 ok, 1 usage, 2 unreadable / truncated / bad format.
"""
from __future__ import annotations

import json
import os
import sys
import time

from ._reader import FORMAT_VERSION, SaveReadError, read_save


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0].startswith("--"):
        print("usage: python -m app.savereader <path-to-SAVEDATA1000-copy>", file=sys.stderr)
        return 1
    path = argv[0]
    t0 = time.perf_counter()
    try:
        data = read_save(path)
    except SaveReadError as e:
        print(json.dumps({"format": FORMAT_VERSION, "ok": False, "error": e.kind}), file=sys.stderr)
        return 2
    try:
        size = os.path.getsize(path)
    except OSError:
        size = None
    print(json.dumps({"format": FORMAT_VERSION, "ok": True, "size": size, "slots": len(data["slots"]),
                      "seconds": round(time.perf_counter() - t0, 3)}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
