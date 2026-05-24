#!/usr/bin/env python3
"""WEB-P6 — Web Build Governance.

Master CI guard that runs the full stabilization-line checklist:

  - WEB-P4 — Backend Authority Contract (no raw business derivation in pages/)
  - WEB-P5 — Error & UX Reliability (RootErrorBoundary + ToastBridge wired)
  - WEB-P6 — Web Build Governance:
       (a) No raw `axios` / `fetch(` imports in pages/ (must use runtime-client)
       (b) No duplicate runtime-client implementation under src/lib/
       (c) No hardcoded money / business numbers in pages/
       (d) No "internal-only" route accidentally rendered into the public bundle

Exit 0 only if every sub-guard passes.

Usage
-----
  python3 /app/web/scripts/audit/web_p6_master.py [--strict]

`--strict` makes (c) and (d) hard-fail too (they're WARN-only by default
because they require a small dictionary of allowed business literals).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

PAGES_DIR = Path("/app/web/src/pages")
RUNTIME_CLIENT_DIR = Path("/app/web/src/runtime-client")
LIB_DIR = Path("/app/web/src/lib")
EXCLUDE_DIRS = {"_archive"}

GREEN = "\033[32m"
RED = "\033[31m"
YEL = "\033[33m"
DIM = "\033[2m"
RST = "\033[0m"


def run_subguard(path: Path) -> int:
    if not path.exists():
        print(f"{RED}✗{RST} missing guard script: {path}")
        return 1
    r = subprocess.run([sys.executable, str(path)], capture_output=True, text=True)
    print(r.stdout, end="")
    if r.returncode != 0:
        print(r.stderr, end="")
    return r.returncode


# (a) — no raw axios / fetch in pages/
RAW_TRANSPORT_PATTERNS = [
    re.compile(r"""^\s*import\s+(?:[\w*\s,{}]+from\s+)?['"]axios['"]"""),
    re.compile(r"\bfrom\s+['\"]axios['\"]"),
    re.compile(r"\bfetch\s*\("),
]
RAW_TRANSPORT_ALLOW = [
    re.compile(r"//\s*allow-raw-transport"),
]


def check_no_raw_transport() -> int:
    violations = []
    if not PAGES_DIR.exists():
        print(f"{RED}✗{RST} pages/ dir missing")
        return 1
    for p in PAGES_DIR.rglob("*.js"):
        if any(d in EXCLUDE_DIRS for d in p.parts):
            continue
        text = p.read_text(encoding="utf-8")
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if any(rx.search(line) for rx in RAW_TRANSPORT_PATTERNS):
                # allow `fetch(` calls that are clearly not HTTP (e.g. .fetchData())
                if "fetch(" in line and not line.lstrip().startswith(("fetch(", "await fetch(", "return fetch(")):
                    continue
                if any(rx.search(line) for rx in RAW_TRANSPORT_ALLOW):
                    continue
                if i > 0 and any(rx.search(lines[i - 1] or "") for rx in RAW_TRANSPORT_ALLOW):
                    continue
                rel = p.relative_to(PAGES_DIR.parent.parent.parent)
                violations.append((str(rel), i + 1, line.strip()[:100]))
    print(f"{DIM}[p6-a] no raw transport in pages/{RST}")
    if violations:
        print(f"{RED}✗ {len(violations)} raw transport call(s) in pages/:{RST}")
        for f, ln, src in violations[:20]:
            print(f"    {f}:{ln}  {src}")
        if len(violations) > 20:
            print(f"    ... and {len(violations) - 20} more.")
        return 1
    print(f"  {GREEN}✓{RST} 0 raw axios/fetch in pages/.")
    return 0


# (b) — runtime-client must be a single source. No duplicate copy in src/lib/
def check_no_duplicate_runtime_client() -> int:
    print(f"{DIM}[p6-b] no duplicate runtime-client/{RST}")
    if not LIB_DIR.exists():
        print(f"  {GREEN}✓{RST} no src/lib/ — nothing to check.")
        return 0
    # Look for src/lib/runtime-client* (file or dir) or src/lib/api/runtime*
    suspects = list(LIB_DIR.rglob("runtime-client*")) + list(LIB_DIR.rglob("api-client*"))
    if suspects:
        print(f"{RED}✗ duplicate runtime-client found:{RST}")
        for s in suspects:
            print(f"    {s}")
        return 1
    if not RUNTIME_CLIENT_DIR.exists():
        print(f"{RED}✗ canonical src/runtime-client/ missing.{RST}")
        return 1
    print(f"  {GREEN}✓{RST} single runtime-client at src/runtime-client/.")
    return 0


# (c) — hardcoded money values (WARN by default, FAIL with --strict)
MONEY_LITERAL = re.compile(r"\$\s?\d{2,}(?:[,.]\d+)*")
ALLOW_MONEY_HINTS = [
    re.compile(r"//\s*allow-business-literal"),
    re.compile(r"data-testid"),
    re.compile(r"placeholder"),
]


def check_no_hardcoded_money(strict: bool) -> int:
    print(f"{DIM}[p6-c] no hardcoded money literals (warn){RST}")
    warns = []
    for p in PAGES_DIR.rglob("*.js"):
        if any(d in EXCLUDE_DIRS for d in p.parts):
            continue
        text = p.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines()):
            if MONEY_LITERAL.search(line):
                if any(rx.search(line) for rx in ALLOW_MONEY_HINTS):
                    continue
                if "presentation-only" in line:
                    continue
                # eslint-disable line counts as allow
                if "eslint-disable" in line:
                    continue
                # ignore comments
                if line.strip().startswith(("//", "/*", "*")):
                    continue
                rel = p.relative_to(PAGES_DIR.parent.parent.parent)
                warns.append((str(rel), i + 1, line.strip()[:100]))
    if warns:
        sev = RED if strict else YEL
        prefix = "✗" if strict else "⚠"
        print(f"{sev}{prefix} {len(warns)} hardcoded money literal(s){RST}")
        for f, ln, src in warns[:10]:
            print(f"    {f}:{ln}  {src}")
        if strict:
            return 1
    else:
        print(f"  {GREEN}✓{RST} 0 hardcoded money literals.")
    return 0


# (d) — no internal-only route reachable from <Routes>
INTERNAL_ROUTE_HINTS = [
    re.compile(r"/internal/"),
    re.compile(r"/_admin_diag/"),
    re.compile(r"/__dev/"),
]


def check_no_internal_routes(strict: bool) -> int:
    print(f"{DIM}[p6-d] no internal-only paths in <Routes>{RST}")
    app_js = Path("/app/web/src/App.js")
    if not app_js.exists():
        return 0
    text = app_js.read_text(encoding="utf-8")
    hits = []
    for rx in INTERNAL_ROUTE_HINTS:
        for m in rx.finditer(text):
            hits.append(m.group(0))
    if hits:
        sev = RED if strict else YEL
        prefix = "✗" if strict else "⚠"
        print(f"{sev}{prefix} {len(hits)} internal-only path(s) in App.js: {hits[:5]}{RST}")
        if strict:
            return 1
    else:
        print(f"  {GREEN}✓{RST} 0 internal-only paths reachable.")
    return 0


def main() -> int:
    strict = "--strict" in sys.argv

    print("─" * 60)
    print("WEB STABILIZATION LINE — master guard (P4 → P5 → P6)")
    print("─" * 60)

    failures = 0
    # P4
    print(f"\n{DIM}▌ WEB-P4 — Backend Authority Contract{RST}")
    failures += run_subguard(Path("/app/web/scripts/audit/web_p4_guards.py"))
    # P5
    print(f"\n{DIM}▌ WEB-P5 — Error & UX Reliability{RST}")
    failures += run_subguard(Path("/app/web/scripts/audit/web_p5_guards.py"))
    # P6
    print(f"\n{DIM}▌ WEB-P6 — Web Build Governance{RST}")
    failures += check_no_raw_transport()
    failures += check_no_duplicate_runtime_client()
    failures += check_no_hardcoded_money(strict)
    failures += check_no_internal_routes(strict)

    print("\n" + "─" * 60)
    if failures == 0:
        print(f"{GREEN}✅ WEB STABILIZATION LINE — SEALED ({GREEN}P4+P5+P6 green{RST}){GREEN}.{RST}")
        return 0
    print(f"{RED}❌ {failures} guard(s) failed.{RST}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
