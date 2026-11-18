"""Parse MHWorldData habitat area strings such as "1,2,3", "2～11,12" or "2～,11"."""
import re

_RANGE = re.compile(r"^\s*(\d+)\s*[～~\-–]\s*(\d*)\s*$")


def parse_areas(text: str | None, zone_count: int | None = None) -> list[int]:
    if not text:
        return []
    out: set[int] = set()
    for part in re.split(r"[,、]", text):
        part = part.strip()
        if not part:
            continue
        m = _RANGE.match(part)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else (zone_count or start)
            out.update(range(start, end + 1))
        elif part.isdigit():
            out.add(int(part))
    return sorted(out)
