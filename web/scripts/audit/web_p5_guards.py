#!/usr/bin/env python3
"""WEB-P5 acceptance guard — Error & UX Reliability.

Lightweight static checks that the WEB-P5 surface is wired:

  1. <RootErrorBoundary> rendered in App.js
  2. <ToastBridgeMount /> rendered in App.js
  3. runtime/index.ts dispatches `runtime:request_failed` window event
  4. ToastBridgeMount listens for `runtime:request_failed` and ignores 401

Exit 0 if all checks pass, otherwise 1.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

CHECKS = [
    {
        "name": "App.js mounts <RootErrorBoundary>",
        "path": Path("/app/web/src/App.js"),
        "pat":  re.compile(r"<RootErrorBoundary>"),
    },
    {
        "name": "App.js mounts <ToastBridgeMount />",
        "path": Path("/app/web/src/App.js"),
        "pat":  re.compile(r"<ToastBridgeMount\s*/?>"),
    },
    {
        "name": "runtime dispatches `runtime:request_failed`",
        "path": Path("/app/web/src/runtime/index.ts"),
        "pat":  re.compile(r"runtime:request_failed"),
    },
    {
        "name": "RootErrorBoundary dispatches `runtime:render_error`",
        "path": Path("/app/web/src/components/RootErrorBoundary.js"),
        "pat":  re.compile(r"runtime:render_error"),
    },
    {
        "name": "ToastBridgeMount listens for `runtime:request_failed`",
        "path": Path("/app/web/src/components/ToastBridgeMount.js"),
        "pat":  re.compile(r"runtime:request_failed"),
    },
    {
        "name": "ToastBridgeMount silently skips 401",
        "path": Path("/app/web/src/components/ToastBridgeMount.js"),
        "pat":  re.compile(r"status === 401|session_expired"),
    },
]

def main() -> int:
    fails = []
    for c in CHECKS:
        p: Path = c["path"]
        if not p.exists():
            fails.append((c["name"], f"missing file {p}"))
            continue
        text = p.read_text(encoding="utf-8")
        if not c["pat"].search(text):
            fails.append((c["name"], "pattern not found"))
    print(f"[web-p5] checks: {len(CHECKS) - len(fails)}/{len(CHECKS)} passed")
    for name, why in fails:
        print(f"  ✗ {name}  ({why})")
    if fails:
        print(f"\n[web-p5] FAIL — {len(fails)} check(s).")
        return 1
    print("[web-p5] OK — RootErrorBoundary + ToastBridge wired.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
