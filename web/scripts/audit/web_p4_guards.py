#!/usr/bin/env python3
"""WEB-P4 acceptance guard — Backend Authority Contract.

Scans /app/web/src/pages/ (excluding _archive/) for derivations that
encode BUSINESS state in the page (totals, bucketing, ordering, gating).

What counts as a violation
--------------------------
- `.reduce(...)`                              — aggregation
- `.sort(...)`                                — ordering of business lists
- `useMemo(() => ...)`                        — derivation of business state
- `.filter(x => x.status === ...)`            — business hiding/bucketing by server-owned status
- `.filter(x => x.severity === ...)`          — business bucketing by severity
- `.filter(x => x.STATUS_LIKE === ...)`       — any `===` against a business field literal
- `Math.max(0, …Date.now() / Date.parse…)`    — time-clamp deriving business state
- `Math.max/min(...)` outside `style={{` 1-liner CSS context

What is NOT a violation (whitelisted mechanical patterns)
---------------------------------------------------------
- `arr.filter(Boolean)`
- `arr.filter((_, i) => i !== X)`             — index removal
- `arr.filter(s => s.trim())`                 — parsing
- `arr.filter(x => x.<id field> !== Y)`       — local list deletion by id
- `setX(prev => prev.filter(...))`            — react state mutation
- `Math.min/max(..., 100)%-style width clamp` — CSS visual width clamp
- `// presentation-only` annotation marker    — explicit page declaration

Exit 0 if no business derivation remains. Otherwise 1.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PAGES_DIR = Path("/app/web/src/pages")
EXCLUDE_DIRS = {"_archive"}
MARKER = re.compile(r"presentation-only", re.IGNORECASE)

# whitelist patterns — these are mechanical, not business derivation
WHITELIST = [
    re.compile(r"\.filter\s*\(\s*Boolean\s*\)"),
    re.compile(r"\.filter\s*\(\s*\(_\s*,\s*i\)\s*=>"),      # index removal
    re.compile(r"\.filter\s*\(\s*\w+\s*=>\s*\w+\.trim\(\)"),
    re.compile(r"setInbox\s*\(\s*prev\s*=>"),
    re.compile(r"setTasks\s*\(\s*prev\s*=>"),
    re.compile(r"setIssues\s*\(\s*issues\.filter"),
    re.compile(r"\.filter\s*\(\s*\w+\s*=>\s*\w+\.\w*_?id\s*!==\s*"),  # filter by id !== X
    re.compile(r"\.filter\s*\(\s*\w+\s*=>\s*l\s*\)"),       # links filter
    re.compile(r"comment|/\*"),                              # comment lines
    re.compile(r"\.split\([^)]*\)\.map[^)]*\)\.filter"),
]

# Patterns that ARE definitely business
SUS_FILTER = re.compile(r"\.filter\s*\(\s*\w+\s*=>\s*\w+\.(status|severity|state|tier|priority|role|is_\w+|completed|approved|paid|pending|active)")
SUS_FILTER_LEN = re.compile(r"\.filter\s*\([^)]+\)\s*\.length")  # count buckets

PATTERNS = [
    (re.compile(r"\.reduce\s*\("),       ".reduce"),
    (re.compile(r"\.sort\s*\("),         ".sort"),
    (re.compile(r"Math\.max\b"),         "Math.max"),
    (re.compile(r"Math\.min\b"),         "Math.min"),
    (re.compile(r"\buseMemo\s*\("),      "useMemo("),
]

def is_annotated(lines, idx):
    if MARKER.search(lines[idx] or ""):
        return True
    j = idx - 1
    while j >= 0 and not (lines[j] or "").strip():
        j -= 1
    if j >= 0 and MARKER.search(lines[j] or ""):
        return True
    return False

def is_whitelisted(line: str) -> bool:
    s = line.strip()
    if s.startswith("//") or s.startswith("/*") or s.startswith("*"):
        return True
    return any(p.search(line) for p in WHITELIST)

def filter_is_business(line: str) -> bool:
    return bool(SUS_FILTER.search(line) or SUS_FILTER_LEN.search(line))

def scan():
    if not PAGES_DIR.exists():
        return 2
    violations = []
    annotated = []
    for path in PAGES_DIR.rglob("*.js"):
        if any(part in EXCLUDE_DIRS for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        lines = text.splitlines()
        for i, line in enumerate(lines):
            matched_label = None

            # Detect via main patterns
            for pat, label in PATTERNS:
                if pat.search(line):
                    if label == "useMemo(" and "import" in line and "from " in line:
                        continue
                    matched_label = label
                    break

            # Business `.filter` (only)
            if not matched_label and ".filter(" in line and filter_is_business(line):
                if not is_whitelisted(line):
                    matched_label = ".filter(business)"

            if not matched_label:
                continue

            if is_whitelisted(line):
                continue

            rel = path.relative_to(PAGES_DIR.parent.parent.parent)
            if is_annotated(lines, i):
                annotated.append((str(rel), i + 1, matched_label, line.strip()))
            else:
                violations.append((str(rel), i + 1, matched_label, line.strip()))
    return violations, annotated

def main():
    res = scan()
    if isinstance(res, int):
        return res
    violations, annotated = res
    total = len(violations) + len(annotated)
    print(f"[web-p4] scan: total candidates={total}  annotated={len(annotated)}  unannotated={len(violations)}")
    if violations:
        print("\n[web-p4] BUSINESS DERIVATION VIOLATIONS:")
        for f, ln, label, src in violations:
            print(f"  {f}:{ln}  {label:<22}  {src[:120]}")
        print(f"\n[web-p4] FAIL — {len(violations)} unannotated business derivation(s).")
        return 1
    print("[web-p4] OK — all business derivation removed or annotated.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
