#!/usr/bin/env python3
"""
WEB-P3.3 — automated migration script: raw axios + raw fetch → runtime singleton.

Migration rules (applied in order, per file):

1.  Remove `import axios from 'axios';` and any other axios import variants.
2.  Ensure `import { runtime } from '@/runtime';` is present (added under the
    last existing `import` line if missing).
3.  Substitute axios METHOD calls:
        axios.get(`${API}/x`, ...)       → runtime.get(`/api/x`, ...)
        axios.post(`${API}/x`, body, ..) → runtime.post(`/api/x`, body, ..)
        axios.put / .patch / .delete same
4.  Strip the inline `{ withCredentials: true }` config object. If the config
    block has other properties, keep them (drop only `withCredentials`).
5.  Replace `${API}/` literal segment inside template strings with `/api/`.
6.  Leave response handling untouched — runtime returns the same `{data,...}`
    envelope as axios.
7.  Leave `try/catch` blocks alone. WEB-P3.4 will normalise error semantics
    (ApiError already thrown by runtime; existing handlers continue to work
    because they only inspect `error.response?.data` / `.status` and ApiError
    sets `.status` field).

The script is idempotent: re-running on an already-migrated file is a no-op.

Author: E1 (WEB-P3 main agent)
Date:   2026-02-FEB
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Tuple


AXIOS_IMPORT_RE = re.compile(
    r"^[ \t]*import\s+axios(?:\s*,\s*\{[^}]*\})?\s+from\s+['\"]axios['\"];?\s*\n",
    re.MULTILINE,
)
AXIOS_NAMED_IMPORT_RE = re.compile(
    r"^[ \t]*import\s*\{[^}]*\}\s*from\s*['\"]axios['\"];?\s*\n",
    re.MULTILINE,
)
RUNTIME_IMPORT_RE = re.compile(
    r"^[ \t]*import\s*\{[^}]*\brun(?:time)\b[^}]*\}\s*from\s*['\"]@?/?(?:\.\./)*runtime['\"];?",
    re.MULTILINE,
)

# Pattern: axios.METHOD( ... )
METHOD_CALL_RE = re.compile(r"\baxios\.(get|post|put|patch|delete)\b")

# Pattern: `${API}/` → `/api/`
API_TEMPLATE_RE = re.compile(r"\$\{API\}/")

# Pattern: { withCredentials: true }
WITHCREDS_OBJECT_RE = re.compile(
    r",\s*\{\s*withCredentials:\s*true\s*\}",
)
# Pattern: { withCredentials: true, ...rest }  → keep rest
WITHCREDS_INLINE_RE = re.compile(
    r"\bwithCredentials\s*:\s*true\s*,?\s*",
)


def ensure_runtime_import(src: str) -> str:
    """Add `import { runtime } from '@/runtime';` if not already present."""
    if RUNTIME_IMPORT_RE.search(src):
        return src
    # Match COMPLETE import statements — including multi-line `import { … } from '…';`
    # form. We non-greedy-match from the leading `import` to the first `from "…";`
    # (with optional semicolon and trailing newline).
    import_re = re.compile(
        r"^[ \t]*import\b[\s\S]+?from\s+['\"][^'\"]+['\"]\s*;?\s*\n",
        re.MULTILINE,
    )
    last_import_end = None
    for m in import_re.finditer(src):
        last_import_end = m.end()
    insert_at = last_import_end if last_import_end is not None else 0
    return src[:insert_at] + "import { runtime } from '@/runtime';\n" + src[insert_at:]


def remove_axios_import(src: str) -> str:
    src = AXIOS_IMPORT_RE.sub("", src)
    src = AXIOS_NAMED_IMPORT_RE.sub("", src)
    return src


def substitute_method_calls(src: str) -> str:
    return METHOD_CALL_RE.sub(r"runtime.\1", src)


def substitute_api_template(src: str) -> str:
    return API_TEMPLATE_RE.sub("/api/", src)


def strip_withcredentials(src: str) -> str:
    # 1. Object as bare second/third positional arg: `, { withCredentials: true }`
    src = WITHCREDS_OBJECT_RE.sub("", src)
    # 2. Inline key in a larger config object — remove key, keep rest.
    src = WITHCREDS_INLINE_RE.sub("", src)
    # Clean up resulting `{ , foo: ... }` or `{ ,}` artefacts (rare).
    src = re.sub(r"\{\s*,\s*", "{ ", src)
    src = re.sub(r",\s*\}", " }", src)
    src = re.sub(r"\{\s*\}", "{}", src)
    return src


def cleanup_unused_api_import(src: str) -> Tuple[str, bool]:
    """Remove `API` from `import { ..., API, ... } from '@/App';` when no
    longer referenced anywhere in the file body.
    """
    # Match the @/App import line variants
    pat = re.compile(
        r"(import\s*\{)([^}]*)(\}\s*from\s*['\"]@/App['\"];?)",
    )
    m = pat.search(src)
    if not m:
        return src, False
    members = [x.strip() for x in m.group(2).split(",") if x.strip()]
    if "API" not in members:
        return src, False
    # Check the body (everything except the import line itself) for `\bAPI\b`
    body = src[: m.start()] + src[m.end() :]
    if re.search(r"\bAPI\b", body):
        return src, False
    new_members = [x for x in members if x != "API"]
    if not new_members:
        # Whole line becomes useless — drop it entirely.
        new_line = ""
    else:
        new_line = m.group(1) + " " + ", ".join(new_members) + " " + m.group(3)
    new_src = src[: m.start()] + new_line + src[m.end() :]
    return new_src, True


def migrate(src: str) -> Tuple[str, List[str]]:
    """Apply all transforms; return (new_src, list of changes)."""
    changes: List[str] = []
    new = src

    if AXIOS_IMPORT_RE.search(new) or AXIOS_NAMED_IMPORT_RE.search(new):
        new = remove_axios_import(new)
        changes.append("removed axios import")
        new = ensure_runtime_import(new)
        if not RUNTIME_IMPORT_RE.search(src):
            changes.append("added runtime import")

    if METHOD_CALL_RE.search(new):
        new, n = METHOD_CALL_RE.subn(r"runtime.\1", new)
        if n:
            changes.append(f"converted {n} axios.METHOD → runtime.METHOD calls")

    if API_TEMPLATE_RE.search(new):
        new, n = API_TEMPLATE_RE.subn("/api/", new)
        if n:
            changes.append(f"rewrote {n} ${{API}}/ → /api/ template segments")

    new2, n = WITHCREDS_OBJECT_RE.subn("", new)
    if n:
        new = new2
        changes.append(f"stripped {n} `, { '{ withCredentials: true }' }` config blocks")

    # Also strip inline withCredentials key if it was inside larger config.
    pre_inline = new
    new2 = WITHCREDS_INLINE_RE.sub("", new)
    if new2 != pre_inline:
        new = new2
        changes.append("stripped inline withCredentials key")
        new = re.sub(r"\{\s*,\s*", "{ ", new)
        new = re.sub(r",\s*\}", " }", new)
        new = re.sub(r"\{\s*\}", "{}", new)

    # Step 7 — drop unused `API` import from `@/App` after `${API}/` rewrite.
    new, dropped = cleanup_unused_api_import(new)
    if dropped:
        changes.append("removed unused `API` from `@/App` import")

    return new, changes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", help="Files to migrate")
    ap.add_argument("--apply", action="store_true",
                    help="Write changes. Without --apply, prints diff summary.")
    args = ap.parse_args()

    total_changed = 0
    for path_str in args.files:
        path = Path(path_str)
        if not path.is_file():
            print(f"SKIP {path} — not a file", file=sys.stderr)
            continue
        original = path.read_text()
        new, changes = migrate(original)
        if new == original:
            print(f"NOOP {path}")
            continue
        total_changed += 1
        print(f"CHANGED {path}")
        for c in changes:
            print(f"  - {c}")
        if args.apply:
            path.write_text(new)
    print(f"\nTotal files changed: {total_changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
