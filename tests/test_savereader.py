"""Parity tests for the pure-Python save reader (api/app/savereader) against the .NET mhw-savereader goldens.

The real save is only ever read (open 'rb' via read_save/load_and_decrypt); mutated inputs are written to tmp_path.
Assertions report only booleans/sizes/paths, never save content.
"""
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

import pytest

pytest.importorskip("Crypto.Cipher.AES", reason="pycryptodome not installed (api/requirements-savereader.txt)")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app.savereader import MINIMUM_LENGTH, SaveReadError, load_and_decrypt, read_save  # noqa: E402
from app.savereader import _crypto  # noqa: E402

SAVE = ROOT / "data" / "saves" / "SAVEDATA1000.copy"
GOLDEN_JSON = ROOT / "build" / "golden" / "savereader.json"
GOLDEN_CHUNKS = ROOT / "build" / "golden" / "savereader_chunks.sha256"

needs_save = pytest.mark.skipif(not (SAVE.is_file() and GOLDEN_JSON.is_file() and GOLDEN_CHUNKS.is_file()),
                                reason="stored save copy or golden files not present")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _strict_diffs(a, b, path=""):
    """Deep compare with exact types (bool is not int, int is not float) and dict key order."""
    if type(a) is not type(b):
        return [f"{path}: type {type(a).__name__} != {type(b).__name__}"]
    if isinstance(a, dict):
        out = [] if list(a) == list(b) else [f"{path}: key order/set differs"]
        for k in a:
            if k in b:
                out += _strict_diffs(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        out = [] if len(a) == len(b) else [f"{path}: length differs"]
        for i, (x, y) in enumerate(zip(a, b)):
            out += _strict_diffs(x, y, f"{path}[{i}]")
        return out
    return [] if a == b else [f"{path}: value differs"]


@pytest.fixture(scope="module")
def save_hash():
    return _sha(SAVE)


@needs_save
def test_decrypted_chunks_match_golden_dump():
    data = load_and_decrypt(str(SAVE))
    golden = [line.split()[0] for line in GOLDEN_CHUNKS.read_text().splitlines() if line.strip()]
    mib = 1 << 20
    mine = [hashlib.sha256(data[i:i + mib]).hexdigest() for i in range(0, len(data), mib)]
    assert len(data) == SAVE.stat().st_size
    assert len(mine) == len(golden)
    assert [m == g for m, g in zip(mine, golden)] == [True] * len(golden)


@needs_save
def test_json_matches_golden_strictly(save_hash):
    mine = read_save(str(SAVE))
    golden = json.loads(GOLDEN_JSON.read_text(encoding="utf-8"))
    diffs = _strict_diffs(mine, golden)
    assert not diffs, diffs[:10]
    # serialised form is identical too (same key order, same number formatting after json round trip)
    assert json.dumps(mine, ensure_ascii=False) == json.dumps(golden, ensure_ascii=False)
    assert _sha(SAVE) == save_hash  # never modified


@needs_save
def test_performance_under_two_seconds():
    read_save(str(SAVE))  # warm table caches/imports
    t = time.perf_counter()
    read_save(str(SAVE))
    assert time.perf_counter() - t < 2.0


@needs_save
def test_cli_prints_only_summary():
    p = subprocess.run([sys.executable, "-m", "app.savereader", str(SAVE)], cwd=ROOT / "api", capture_output=True,
                       text=True, timeout=60)
    assert p.returncode == 0
    out = json.loads(p.stdout)
    assert set(out) == {"format", "ok", "size", "slots", "seconds"}
    assert out["ok"] is True and out["size"] == SAVE.stat().st_size


# ------------------------------------------------------------------ error parity (kinds of Program.cs's error JSON)

def _kind(path) -> str:
    with pytest.raises(SaveReadError) as e:
        read_save(str(path))
    return e.value.kind


def test_empty_file_is_truncated(tmp_path):
    p = tmp_path / "empty"
    p.write_bytes(b"")
    assert _kind(p) == "truncated"


def test_short_file_is_truncated(tmp_path):
    p = tmp_path / "short"
    p.write_bytes(b"\0" * (MINIMUM_LENGTH - 8))
    assert _kind(p) == "truncated"


def test_length_not_multiple_of_8_is_truncated(tmp_path):
    p = tmp_path / "odd"
    p.write_bytes(b"\0" * (MINIMUM_LENGTH + 3))
    assert _kind(p) == "truncated"


def test_too_large_is_rejected_up_front(tmp_path):
    p = tmp_path / "huge"
    with open(p, "wb") as f:
        f.truncate(32 * 1024 * 1024 + 8)  # sparse; never read
    assert _kind(p) == "bad_format"


def test_missing_file_is_not_found(tmp_path):
    assert _kind(tmp_path / "nope" / "SAVEDATA1000") == "not_found"
    assert _kind(tmp_path / "nope.bin") == "not_found"


def test_directory_is_io_error(tmp_path):
    assert _kind(tmp_path) == "io_error"


def _layer1_plain(src: Path) -> bytearray:
    return bytearray(_crypto.blowfish_decrypt(src.read_bytes()))


def _write_layer1(dst: Path, plain: bytearray) -> None:
    dst.write_bytes(_crypto.blowfish_encrypt(bytes(plain)))


@needs_save
def test_bad_signature_is_bad_format(tmp_path):
    plain = _layer1_plain(SAVE)  # bytes 88..95 are outside the Iceborne regions: layer 1 only
    struct.pack_into("<q", plain, 88, 0)  # section 3 "starts" at the header, whose first u32 is not the signature
    p = tmp_path / "badsig"
    _write_layer1(p, plain)
    assert _kind(p) == "bad_format"


@needs_save
def test_truncated_real_copy_is_truncated(tmp_path):
    p = tmp_path / "cut"
    with open(SAVE, "rb") as f:
        p.write_bytes(f.read(SAVE.stat().st_size - 4096))
    assert _kind(p) == "truncated"


@needs_save
def test_unmodified_copy_parses(tmp_path):
    p = tmp_path / "copy"
    shutil.copyfile(SAVE, p)
    assert read_save(str(p))["signature_ok"] is True


def test_crc_matches_reference_loop():
    import os

    def ref(iv, data):
        for b in data:
            t = (iv ^ b) & 0xFF
            for _ in range(8):
                t = (t >> 1) ^ 0xEDB88320 if t & 1 else t >> 1
            iv = (iv >> 8) ^ t
        return iv

    for n in (0, 1, 7, 512):
        blob = os.urandom(n)
        assert _crypto._crc32(0xA37A55D7, blob) == ref(0xA37A55D7, blob)


def test_round2_is_bankers_on_scaled_double():
    from app.savereader._reader import _round2
    assert _round2(0.125) == 0.12 and _round2(0.375) == 0.38  # exact halves -> even
    assert _round2(1109.66 * 123 / 100.0) == 1364.88
