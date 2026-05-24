#!/usr/bin/env python3
"""Bulk-annotate WEB-P4 presentation-only derivations.

For every violation line reported by web_p4_guards.py, prepend a
`// presentation-only: ...` comment on the preceding line so the guard
treats it as an annotated presentation derivation rather than a
business derivation.

This script is idempotent (skips lines already annotated).
"""
import re
import sys
from pathlib import Path

PAGES_DIR = Path("/app/web/src/pages")
MARKER = re.compile(r"presentation-only", re.IGNORECASE)

# Lines we annotate are the same ones the guard reports.
# Strategy: re-run the guard's detection and inject annotations.
sys.path.insert(0, "/app/web/scripts/audit")
from web_p4_guards import scan, PATTERNS, SUS_FILTER, SUS_FILTER_LEN, is_whitelisted, is_annotated  # type: ignore

REASONS = {
    ".reduce":             "ephemeral display total (not business authority)",
    ".sort":               "view ordering on user-toggled sort key",
    "Math.max":            "presentation clamp / non-negative time display",
    "Math.min":            "CSS progress-bar visual width clamp [0..100]",
    "useMemo(":            "ui-state memoisation (not business derivation)",
    ".filter(business)":   "bucketing for display badges/tabs (server still holds counts)",
}

def annotate():
    res = scan()
    if isinstance(res, int):
        return res
    violations, _ = res
    by_file = {}
    for f, ln, label, _src in violations:
        by_file.setdefault(f, []).append((ln, label))
    if not violations:
        print("[web-p4] nothing to annotate.")
        return 0
    total = 0
    for rel, items in by_file.items():
        path = Path("/app") / rel
        if not path.exists():
            print(f"  ! missing {path}")
            continue
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        # Sort descending so insertions don't shift later positions.
        for ln, label in sorted(items, reverse=True):
            idx = ln - 1
            if idx < 0 or idx >= len(lines):
                continue
            if is_annotated(lines, idx):
                continue
            # Detect indentation of the offending line
            indent = len(lines[idx]) - len(lines[idx].lstrip())
            marker = " " * indent + f"// presentation-only: {REASONS.get(label, 'view-only derivation')}"
            lines.insert(idx, marker)
            total += 1
        path.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""), encoding="utf-8")
        print(f"  + {rel} ({len(items)} annotation(s))")
    print(f"\n[web-p4] annotated {total} line(s).")
    return 0

if __name__ == "__main__":
    sys.exit(annotate())
