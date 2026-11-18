"""Small Windows helpers (ctypes only). Every function degrades to a no-op/None outside Windows."""
from __future__ import annotations

import os
import sys

IS_WINDOWS = os.name == "nt"
ERROR_ALREADY_EXISTS = 183

_mutex_handle = None  # kept alive for the whole process lifetime


def acquire_mutex(name: str) -> bool:
    """Create a named mutex. True if we are the first owner, False if another process already holds it."""
    global _mutex_handle
    if not IS_WINDOWS:
        return True
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    k32.CreateMutexW.restype = wintypes.HANDLE
    h = k32.CreateMutexW(None, False, name)
    err = ctypes.get_last_error()
    if not h:
        return True  # could not create it: do not block the app
    if err == ERROR_ALREADY_EXISTS:
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        k32.CloseHandle(h)
        return False
    _mutex_handle = h
    return True


def message_box(title: str, text: str) -> None:
    if not IS_WINDOWS:
        print(f"{title}: {text}", file=sys.stderr)
        return
    import ctypes
    try:
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)  # MB_OK | MB_ICONERROR
    except Exception:
        pass


def _descendant_pids(root_pid: int) -> set[int]:
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k32.Process32FirstW.argtypes = k32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)
    pids = {root_pid}
    if not snap or snap == wintypes.HANDLE(-1).value:
        return pids
    try:
        pairs = []
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(e)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            pairs.append((e.th32ProcessID, e.th32ParentProcessID))
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    grew = True
    while grew:
        grew = False
        for pid, ppid in pairs:
            if ppid in pids and pid not in pids:
                pids.add(pid)
                grew = True
    return pids


def bring_window_to_front(pid: int) -> bool:
    """Show/raise the first visible titled top-level window owned by pid or one of its descendants."""
    if not IS_WINDOWS or not isinstance(pid, int) or pid <= 0:
        return False
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    pids = _descendant_pids(pid)
    found: list[int] = []
    proc_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(hwnd, _lp):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value in pids and user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd) > 0:
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(proc_t(cb), 0)
    if not found:
        return False
    hwnd = found[0]
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    return True


def _enum_top_windows():
    """Yield (class_name, title) of every top-level window (visible, hidden or minimized)."""
    if not IS_WINDOWS:
        return []
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    out: list[tuple[str, str]] = []
    proc_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    cls_buf, title_buf = ctypes.create_unicode_buffer(256), ctypes.create_unicode_buffer(512)

    def cb(hwnd, _lp):
        if user32.GetWindowTextW(hwnd, title_buf, 512) > 0:
            user32.GetClassNameW(hwnd, cls_buf, 256)
            out.append((cls_buf.value, title_buf.value))
        return True

    user32.EnumWindows(proc_t(cb), 0)
    return out


def has_app_window(title_fragment: str = "Guía MHW", enumerator=None) -> bool:
    """True if any top-level Chromium window (class Chrome_WidgetWin_1) has a non-empty title containing the fragment."""
    try:
        for cls, title in (enumerator or _enum_top_windows)():
            if title and cls == "Chrome_WidgetWin_1" and title_fragment in title:
                return True
    except Exception:
        return True  # cannot tell: never stop the server because of an enumeration failure
    return False


def find_edge() -> str | None:
    """msedge.exe from the standard (admin-only writable) install folders, then App Paths (HKLM, then HKCU)."""
    from .launcher import validate_edge_path
    cands: list[str] = []
    for var in ("ProgramFiles(x86)", "ProgramFiles"):
        base = os.environ.get(var)
        if base:
            cands.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    if IS_WINDOWS:
        try:
            import winreg
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe") as k:
                        cands.append(str(winreg.QueryValueEx(k, "")[0]).strip().strip('"'))
                except OSError:
                    pass
        except ImportError:
            pass
    for c in cands:
        if validate_edge_path(c):
            return os.path.normpath(c)
    return None
