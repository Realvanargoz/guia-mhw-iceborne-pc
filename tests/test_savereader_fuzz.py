"""Robustness fuzzing of api/app/savereader. Every input is a file written to tmp_path (copies/mutations of the stored
save or random bytes); the original save is only read. Each case must parse or raise SaveReadError, within 2 s,
with bounded Python memory (tracemalloc), and without any other exception escaping.
"""
import os
import random
import struct
import sys
import time
import tracemalloc
from pathlib import Path

import pytest

pytest.importorskip("Crypto.Cipher.AES", reason="pycryptodome not installed (api/requirements-savereader.txt)")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app.savereader import MAXIMUM_LENGTH, MINIMUM_LENGTH, SaveReadError, read_save  # noqa: E402
from app.savereader import _crypto  # noqa: E402

SAVE = ROOT / "data" / "saves" / "SAVEDATA1000.copy"
needs_save = pytest.mark.skipif(not SAVE.is_file(), reason="stored save copy not present")
KINDS = {"not_found", "truncated", "bad_format", "io_error", "error"}
SLOT_SIZE = 2_136_768


def _run(path: Path) -> str:
    """Returns 'ok' or the error kind; fails on time/memory/unexpected exceptions."""
    size = path.stat().st_size
    tracemalloc.start()
    t = time.perf_counter()
    try:
        out = read_save(str(path))
        result = "ok"
        assert isinstance(out, dict) and out["signature_ok"] is True
    except SaveReadError as e:
        assert e.kind in KINDS
        result = e.kind
    finally:
        elapsed = time.perf_counter() - t
        peak = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
    assert elapsed < 2.0, f"{path.name}: {elapsed:.2f}s"
    # decrypt needs ~3 copies of the input at most; anything far beyond means unbounded allocation
    assert peak < 4 * min(size, MAXIMUM_LENGTH) + 64 * 2 ** 20, f"{path.name}: peak {peak} bytes"
    return result


@pytest.fixture(scope="module")
def original():
    with open(SAVE, "rb") as f:
        return f.read()


@pytest.fixture(scope="module")
def layer1(original):
    return bytes(_crypto.blowfish_decrypt(original))


@needs_save
def test_truncated_at_many_offsets(tmp_path, original):
    n = len(original)
    rng = random.Random(1234)
    first = 0x3010D8
    offsets = {0, 1, 7, 8, 63, 64, 88, 96, 0x70, 0xDAC0, 0x3010C8, 0x3010D0, MINIMUM_LENGTH - 8, MINIMUM_LENGTH - 1,
               MINIMUM_LENGTH, first + 3 * SLOT_SIZE - 8, n - 8, n - 1}
    offsets |= {rng.randrange(0, n) for _ in range(10)}
    for i, off in enumerate(sorted(o for o in offsets if 0 <= o < n)):
        p = tmp_path / f"cut_{i}"
        p.write_bytes(original[:off])
        # section 3 declares its own end 8 bytes before EOF, so only cuts before that point must be rejected
        assert _run(p) == "truncated" or off >= n - 8, off
        p.unlink()


def test_random_bytes_various_sizes(tmp_path):
    rng = random.Random(42)
    sizes = [0, 1, 8, 1000, 4096, MINIMUM_LENGTH - 8, MINIMUM_LENGTH, MINIMUM_LENGTH + 5, 11_284_704,
             16 * 2 ** 20, MAXIMUM_LENGTH, MAXIMUM_LENGTH + 8]
    for i, size in enumerate(sizes):
        p = tmp_path / f"rnd_{i}"
        p.write_bytes(rng.randbytes(size))
        assert _run(p) in KINDS  # random data is never a valid save
        p.unlink()


@needs_save
def test_bit_flips_in_valid_copy(tmp_path, original):
    rng = random.Random(7)
    n = len(original)
    results = []
    for i in range(16):
        buf = bytearray(original)
        for _ in range(rng.choice((1, 4, 64))):
            pos = rng.randrange(n)
            buf[pos] ^= 1 << rng.randrange(8)
        p = tmp_path / f"flip_{i}"
        p.write_bytes(buf)
        results.append(_run(p))
        p.unlink()
    assert set(results) <= KINDS | {"ok"}


@needs_save
@pytest.mark.parametrize("field,value", [
    ("s3off", 2 ** 63 - 1), ("s3off", -1), ("s3off", -2 ** 63), ("s3off", 11_284_704), ("s3off", 11_284_703),
    ("s3off", 11_284_701), ("s3off", 11_284_696),
    ("secsize", 2 ** 63 - 1), ("secsize", -1), ("secsize", 0), ("secsize", 3 * SLOT_SIZE - 1),
    ("secsize", 11_284_704), ("secsize", 11_284_704 - 0x3010D8 + 1),
])
def test_huge_fake_internal_lengths(tmp_path, layer1, field, value):
    plain = bytearray(layer1)  # the section-3 header lives outside the Iceborne regions: layer 1 is enough
    s3 = struct.unpack_from("<q", plain, 88)[0]
    assert s3 + 16 <= 0x3010D8 or field == "s3off"
    if field == "s3off":
        struct.pack_into("<q", plain, 88, value)
    else:
        struct.pack_into("<q", plain, s3 + 8, value)
    p = tmp_path / "fake"
    p.write_bytes(_crypto.blowfish_encrypt(bytes(plain)))
    assert _run(p) in {"truncated", "bad_format"}


def test_unreadable_paths(tmp_path):
    with pytest.raises(SaveReadError) as e:
        read_save(str(tmp_path / "missing"))
    assert e.value.kind == "not_found"
    with pytest.raises(SaveReadError) as e:
        read_save(str(tmp_path))
    assert e.value.kind == "io_error"
    with pytest.raises(SaveReadError) as e:
        read_save(os.devnull)  # zero-length special file
    assert e.value.kind in {"truncated", "io_error"}
