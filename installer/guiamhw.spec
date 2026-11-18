# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec: GuiaMHW portable (onedir, windowed). Run through scripts/build-windows.ps1.

Frozen layout (PyInstaller 6, onedir): everything below lands in dist/GuiaMHW/_internal == sys._MEIPASS ==
settings.RESOURCE_DIR, so settings.py finds:  _MEIPASS/catalog.db  and  _MEIPASS/research  (as it expects).
`web/` and `icons/` are served via settings.WEB_DIST / settings.ICONS_DIR, which are env-driven: the launcher must
set MHW_WEB_DIST=<_MEIPASS>/web and MHW_ICONS_DIR=<_MEIPASS>/icons (see build report).

Inputs come ONLY from build/stage (made by build-windows.ps1) + api/app (code and savereader data). Nothing else.
"""
import os
import re
from pathlib import Path

ROOT = Path(SPECPATH).resolve().parent            # noqa: F821  (SPECPATH is injected by PyInstaller)
STAGE = ROOT / "build" / "stage"
API = ROOT / "api"
ENTRY = Path(os.environ.get("MHW_ENTRY") or (ROOT / "installer" / "entry.py"))   # MHW_ENTRY: test override only


def _version() -> str:
    v = os.environ.get("MHW_VERSION")
    if v:
        return v
    m = re.search(r'^VERSION\s*(?::\s*\w+\s*)?=\s*["\']([^"\']+)["\']', (API / "app" / "version.py").read_text("utf-8"), re.M)
    return m.group(1) if m else "0.0.0"


def _ver_tuple(v: str):
    nums = [int(x) for x in re.findall(r"\d+", v)[:4]]
    return tuple(nums + [0] * (4 - len(nums)))


VERSION = _version()

# ---------------------------------------------------------------- explicit data (no globbing of the repo)
datas = []
for rel in ("web", "icons", "research"):
    if not (STAGE / rel).is_dir():
        raise SystemExit(f"missing staged dir {STAGE / rel} (run scripts/build-windows.ps1)")
    datas.append((str(STAGE / rel), rel))
if not (STAGE / "catalog.db").is_file():
    raise SystemExit("missing build/stage/catalog.db")
datas.append((str(STAGE / "catalog.db"), "."))
# savereader data (4 JSON files) as package data of `app`
for f in sorted((API / "app" / "savereader" / "data").glob("*.json")):
    datas.append((str(f), "app/savereader/data"))

# ---------------------------------------------------------------- imports
# uvicorn[standard] extras are NOT installed: pin the pure-python backends explicitly (h11 + asyncio).
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan", "uvicorn.lifespan.on", "uvicorn.lifespan.off",
    "multipart", "multipart.multipart",
    "app.main", "app.launcher",
]
# Only the Crypto modules app/savereader/_crypto.py uses (AES + Blowfish, ECB) and their helpers.
_CRYPTO_EXCLUDES = ["Crypto.SelfTest", "Crypto.PublicKey", "Crypto.Signature", "Crypto.Protocol", "Crypto.IO",
                    "Crypto.Hash", "Crypto.Math"]
excludes = [
    "tkinter", "_tkinter", "turtle", "unittest", "pydoc_data", "pydoc", "lib2to3", "idlelib", "ensurepip", "test",
    "distutils", "setuptools", "pkg_resources", "pip", "curses", "_curses", "_lzma", "lzma", "_bz2", "bz2",
    "xmlrpc", "doctest", "sqlite3.test", "PIL", "numpy", "pytest",
] + _CRYPTO_EXCLUDES

a = Analysis(  # noqa: F821
    [str(ENTRY)],
    pathex=[str(API)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=2,
)

# pyinstaller-hooks-contrib's Crypto hook collects every Crypto.* binary regardless of `excludes`: drop the ones
# the savereader never imports (it only needs Crypto.Cipher.AES / Blowfish, ECB, Crypto.Util, Crypto.Random).
_DROP = ("Crypto/PublicKey/", "Crypto/Signature/", "Crypto/Protocol/", "Crypto/IO/", "Crypto/SelfTest/", "Crypto/Math/")
def _keep(entry):
    return not entry[0].replace("\\", "/").startswith(_DROP)
a.binaries = [e for e in a.binaries if _keep(e)]
a.datas = [e for e in a.datas if _keep(e)]
a.pure = [e for e in a.pure if not e[0].startswith(("Crypto.PublicKey", "Crypto.Signature", "Crypto.Protocol",
                                                    "Crypto.IO", "Crypto.SelfTest", "Crypto.Math"))]

# ---------------------------------------------------------------- version metadata
from PyInstaller.utils.win32.versioninfo import (  # noqa: E402
    FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo)

_vt = _ver_tuple(VERSION)
version_info = VSVersionInfo(
    ffi=FixedFileInfo(filevers=_vt, prodvers=_vt, mask=0x3F, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("CompanyName", "GuiaMHW"),
            StringStruct("FileDescription", "Guia MHW (Monster Hunter World: Iceborne)"),
            StringStruct("FileVersion", VERSION),
            StringStruct("InternalName", "GuiaMHW"),
            StringStruct("OriginalFilename", "GuiaMHW.exe"),
            StringStruct("ProductName", "Guia MHW"),
            StringStruct("ProductVersion", VERSION),
        ])]),
        VarFileInfo([VarStruct("Translation", [0x0409, 1200])]),
    ],
)

pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="GuiaMHW",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(ROOT / "installer" / "guiamhw.ico"),
    version=version_info,
)
coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="GuiaMHW",
)
