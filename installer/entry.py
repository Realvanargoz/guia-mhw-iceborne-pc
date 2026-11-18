"""PyInstaller entry point for the desktop launcher."""
import multiprocessing
import os
import sys

if not getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api"))

if __name__ == "__main__":
    if getattr(sys, "frozen", False):
        multiprocessing.freeze_support()
    from app.launcher import main
    raise SystemExit(main(sys.argv[1:]))
