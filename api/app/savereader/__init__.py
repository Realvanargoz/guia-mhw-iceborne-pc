"""Pure-Python, in-process port of tools/savereader (``mhw-savereader``).

``read_save(path)`` returns the same structure the .NET tool printed with ``--json`` (as ``json.loads`` gives it);
``SaveReadError.kind`` carries the same error strings as the tool's error JSON
(not_found, truncated, bad_format, io_error, error). Needs pycryptodome (Blowfish + AES), see
api/requirements-savereader.txt. Never writes anything: the input is only opened with ``open(path, "rb")``.
"""
from ._reader import FORMAT_VERSION, MAXIMUM_LENGTH, MINIMUM_LENGTH, SaveReadError, load_and_decrypt, read_save

__all__ = ["read_save", "load_and_decrypt", "SaveReadError", "FORMAT_VERSION", "MINIMUM_LENGTH", "MAXIMUM_LENGTH"]
