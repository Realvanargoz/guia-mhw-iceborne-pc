"""In-memory decryption of a SAVEDATA1000 copy (port of Vendor/MHWCrypto: Crypto.cs, Blowfish.cs, CryptoSecondLayer.cs).

Layer 1: Blowfish-ECB over the whole file with the standard algorithm, except that each 64-bit block is loaded as two
little-endian 32-bit words (so we byte-swap every word around pycryptodome's big-endian Blowfish).
Layer 2 (Iceborne, Cirilla's IceborneCrypto.DecryptRegion): four regions, each split into 32 AES-128-ECB segments with
per-segment keys; every 16-byte block is XOR-masked with salt bytes before and after the AES step. The masks only touch
bytes inside their own block and repeat every 128 blocks, so each segment is processed with one XOR, one AES call and
another XOR over the whole segment.
"""
from __future__ import annotations

import struct
import zlib
from array import array

from Crypto.Cipher import AES, Blowfish

from ._iceborne_tables import FLOAT_CONSTANTS_HEX, INTEGER_CONSTANTS_HEX

BLOWFISH_KEY = b"xieZjoe#P2134-3zmaghgpqoe0z8$3azeq"
ENCRYPTED_REGIONS = ((0x70, 0xDA50), (0x3010D8, 0x2098C0), (0x50AB98, 0x2098C0), (0x714658, 0x2098C0))
SALT_LEN = 0x200
M32 = 0xFFFFFFFF

_INTS = struct.unpack("<4096I", bytes.fromhex("".join(INTEGER_CONSTANTS_HEX)))
_FLOATS = struct.unpack("<4096f", bytes.fromhex("".join(FLOAT_CONSTANTS_HEX)))  # exact float32 values as doubles


def _f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0]


def _words(buf: bytes) -> array:
    a = array("I")
    if a.itemsize != 4:  # pragma: no cover - every supported platform has a 4-byte unsigned int
        raise RuntimeError("array('I') is not 32-bit on this platform")
    a.frombytes(buf)
    return a


def _blowfish(buf: bytes, encrypt: bool) -> array:
    """Layer 1 over ``buf`` (length must be a multiple of 8), done in place on one word array."""
    a = _words(buf)
    a.byteswap()  # the game loads each 32-bit half little-endian; pycryptodome's Blowfish is big-endian
    mv = memoryview(a).cast("B")
    cipher = Blowfish.new(BLOWFISH_KEY, Blowfish.MODE_ECB)
    (cipher.encrypt if encrypt else cipher.decrypt)(mv, output=mv)
    a.byteswap()
    return a


def blowfish_decrypt(buf: bytes) -> bytes:
    return _blowfish(buf, False).tobytes()


def blowfish_encrypt(buf: bytes) -> bytes:
    """Inverse of :func:`blowfish_decrypt` (used only by tests to craft inputs)."""
    return _blowfish(buf, True).tobytes()


def _crc32(iv: int, data: bytes) -> int:
    # Cirilla's Crc32 is the reflected CRC-32 update without the initial/final inversion.
    return ~zlib.crc32(data, ~iv & M32) & M32


def _salt(key_salt: int) -> bytes:
    c = key_salt ^ 0x4BF0CF23
    offset = 0x5D7
    change = (key_salt >> 24) + (key_salt >> 16 & 0xFF) + (key_salt >> 8 & 0xFF) + (key_salt & 0xFF) + 1
    words = []
    for _ in range(SALT_LEN // 4):
        s = _INTS[offset & 0xFFF] ^ c
        if s & 7 == 1:  # ((-(s & 7)) + 1) == 0
            s ^= 0x0BD75F29
        words.append(s)
        offset = (offset + change) & M32
    return struct.pack("<128I", *words)


def _keys(key_salt: int, salt: bytes) -> list[bytes]:
    cs = (0x5A8B79A9 ^ key_salt, 0x34616F90 ^ key_salt, 0xC4C638DF ^ key_salt, 0x94FB64E8 ^ key_salt)
    out = []
    for i in range(32):
        k = struct.unpack_from("<I", salt, i * 4)[0]
        out.append(struct.pack("<4I", *(k ^ c for c in cs)))
    return out


def _key_lengths(key_salt: int, length: int) -> list[int]:
    avg = length >> 5
    expected = avg
    out = []
    for i in range(31):
        a = _INTS[((key_salt + i) & 0xFFF) ^ 0x5D7]
        b = _f32(_FLOATS[(a & 0xFFF) ^ 0x885] - 0.5)  # float - 0.5F, in float32
        prod = _f32(b * avg)  # float * int -> float32
        v = (int(prod) + expected + 0xF) & 0xFFFFFFF0  # int + int + 0xF, then & uint -> long
        out.append(int(_f32(float(v))))  # stored in a float, then cast back to int
        expected += avg
    out.append(length)
    return out


def _masks(salt: bytes) -> tuple[bytes, bytes]:
    """Pre/post XOR masks for 128 consecutive blocks (salt offset 0, 4, ... 508)."""
    pre = bytearray(128 * 16)
    post = bytearray(128 * 16)
    for blk in range(128):
        so = blk * 4
        sb = lambda k: salt[(so + k) & 0x1FF]  # noqa: E731
        base = blk * 16
        # branch = 4 when the salt byte is even: pre-mask on bytes 0-3/8-11, post-mask on 4-7/12-15; else swapped.
        lo, hi = (0, 4) if (salt[so & 0x1FF] & 1) == 0 else (4, 0)
        for j in range(4):
            pre[base + lo + j] = sb(8 + j)
            pre[base + lo + 8 + j] = sb(12 + j)
            post[base + hi + j] = sb(j)
            post[base + hi + 8 + j] = sb(4 + j)
    return bytes(pre), bytes(post)


def _xor(a: bytes, b: bytes) -> bytes:
    n = len(a)
    return (int.from_bytes(a, "little") ^ int.from_bytes(b, "little")).to_bytes(n, "little")


def iceborne_decrypt_region(data, offset: int, length: int) -> None:
    """In-place port of IceborneCrypto.DecryptRegion. Caller guarantees offset + length + 0x200 <= len(data)."""
    key_salt = _crc32(0xA37A55D7, bytes(data[offset + length:offset + length + SALT_LEN]))
    salt = _salt(key_salt)
    keys = _keys(key_salt, salt)
    lengths = _key_lengths(key_salt, length)
    pre, post = _masks(salt)
    pos = offset
    for i in range(32):
        end = lengths[i] + offset
        if pos >= end:
            continue
        nblocks = (end - pos + 15) // 16
        n = nblocks * 16
        reps = nblocks // 128 + 1
        seg = bytes(data[pos:pos + n])
        if len(seg) != n:  # unreachable for the fixed regions; keeps the loop bounded anyway
            raise ValueError("encrypted region exceeds buffer")
        seg = _xor(seg, (pre * reps)[:n])
        seg = AES.new(keys[i], AES.MODE_ECB).decrypt(seg)
        data[pos:pos + n] = _xor(seg, (post * reps)[:n])
        pos += n


def decrypt(buf: bytes) -> bytes:
    """Both layers; ``buf`` must be a multiple of 8 bytes and cover the last region's salt."""
    a = _blowfish(buf, False)
    data = memoryview(a).cast("B")  # writable view: no extra copy of the whole file
    for off, size in ENCRYPTED_REGIONS:
        iceborne_decrypt_region(data, off, size)
    data.release()
    return a.tobytes()
