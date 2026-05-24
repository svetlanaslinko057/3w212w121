#!/usr/bin/env python3
"""
WEB-P3.5 — runtime guards.

Enforces three architectural invariants on the web client. Designed to be wired
into CI under WEB-P6, but already runnable today.

Invariants:

  G1 — Zero raw axios imports in /app/web/src/pages/
  G2 — Zero raw fetch( calls in /app/web/src/pages/
  G3 — Single canonical runtime-client source: /app/packages/runtime-client/src/
       (the /app/web/src/runtime-client/ path MUST be a symlink to it)

Exit code 0 if all green; 1 if any guard fails. Detailed report goes to stdout.

Usage:
    python3 /app/web/scripts/audit/web_p3_guards.py
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

WEB_PAGES = Path("/app/web/src/pages")
WEB_RUNTIME_CLIENT = Path("/app/web/src/runtime-client")
PACKAGES_RUNTIME_CLIENT = Path("/app/packages/runtime-client/src")
EXCLUDE_DIRS = {"_archive"}


def scan_pages_for_pattern(needle_re: re.Pattern) -> list[tuple[Path, int, str]]:
    """Find regex matches in /app/web/src/pages/ excluding _archive/."""
    hits: list[tuple[Path, int, str]] = []
    for root, dirs, files in os.walk(WEB_PAGES):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if not f.endswith((".js", ".jsx", ".ts", ".tsx")):
                continue
            full = Path(root) / f
            try:
                lines = full.read_text().splitlines()
            except Exception:
                continue
            for i, line in enumerate(lines, 1):
                if needle_re.search(line):
                    hits.append((full, i, line.strip()))
    return hits


def g1_zero_raw_axios() -> bool:
    pat = re.compile(r"^\s*(?:import\s+axios|import\s*\{[^}]*\}\s*from\s*['\"]axios['\"]|require\(\s*['\"]axios['\"]\s*\))")
    hits = scan_pages_for_pattern(pat)
    print(f"[G1] Raw axios imports in web/src/pages/: {len(hits)}")
    for full, ln, snippet in hits[:20]:
        print(f"     ✗ {full.relative_to('/app')}:{ln}  {snippet[:80]}")
    return not hits


def g2_zero_raw_fetch() -> bool:
    pat = re.compile(r"\bfetch\s*\(")
    hits = scan_pages_for_pattern(pat)
    print(f"[G2] Raw fetch( calls in web/src/pages/: {len(hits)}")
    for full, ln, snippet in hits[:20]:
        print(f"     ✗ {full.relative_to('/app')}:{ln}  {snippet[:80]}")
    return not hits


def g3_single_runtime_client_source() -> bool:
    if not PACKAGES_RUNTIME_CLIENT.is_dir():
        print(f"[G3] ✗ canonical source missing: {PACKAGES_RUNTIME_CLIENT}")
        return False
    if not WEB_RUNTIME_CLIENT.exists():
        # No second copy at all — acceptable, but warn (most imports use the alias).
        print(f"[G3] note: {WEB_RUNTIME_CLIENT} not present — OK if all imports use packages alias")
        return True
    if not WEB_RUNTIME_CLIENT.is_symlink():
        print(f"[G3] ✗ {WEB_RUNTIME_CLIENT} exists as a DIRECTORY (duplicate copy of canonical source).")
        print(f"        Expected: symlink → ../../packages/runtime-client/src")
        return False
    target = os.readlink(WEB_RUNTIME_CLIENT)
    resolved = (WEB_RUNTIME_CLIENT.parent / target).resolve()
    if resolved != PACKAGES_RUNTIME_CLIENT.resolve():
        print(f"[G3] ✗ symlink target wrong: {resolved} (expected: {PACKAGES_RUNTIME_CLIENT})")
        return False
    print(f"[G3] ✓ single canonical runtime-client source (symlink {WEB_RUNTIME_CLIENT} → {target})")
    return True


def main() -> int:
    print("=" * 60)
    print("WEB-P3.5 — runtime architecture guards")
    print("=" * 60)
    results = [
        ("G1 — zero raw axios in pages/", g1_zero_raw_axios()),
        ("G2 — zero raw fetch in pages/", g2_zero_raw_fetch()),
        ("G3 — single runtime-client source", g3_single_runtime_client_source()),
    ]
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    ok = True
    for name, passed in results:
        flag = "✓" if passed else "✗"
        print(f"  {flag}  {name}")
        ok = ok and passed
    print()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
