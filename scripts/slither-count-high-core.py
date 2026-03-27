#!/usr/bin/env python3
"""
Count Slither High-impact findings that touch contracts/core/ only.

Slither's --include-paths does not reliably trim the --json report; CI must
filter detector elements by filename so the gate matches CertiK scope.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


CORE_MARKER = "contracts/core/"


def _norm(p: str) -> str:
    return (p or "").replace("\\", "/")


def _mapping_touches_core(sm: dict | None) -> bool:
    if not sm:
        return False
    for key in ("filename_short", "filename_relative", "filename_absolute"):
        if CORE_MARKER in _norm(sm.get(key) or ""):
            return True
    return False


def _element_touches_core(el: dict) -> bool:
    if _mapping_touches_core(el.get("source_mapping")):
        return True
    parent = (el.get("type_specific_fields") or {}).get("parent") or {}
    if _mapping_touches_core(parent.get("source_mapping")):
        return True
    return False


def finding_touches_core(result: dict) -> bool:
    elements = result.get("elements") or []
    return any(_element_touches_core(el) for el in elements if isinstance(el, dict))


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "slither-report.json")
    if not path.is_file():
        print("0")
        return 0

    data = json.loads(path.read_text(encoding="utf-8"))
    detectors = (data.get("results") or {}).get("detectors") or []

    highs = [
        r
        for r in detectors
        if r.get("impact") == "High"
        and r.get("confidence") in ("High", "Medium")
        and finding_touches_core(r)
    ]

    n = len(highs)
    print(n)
    if highs:
        for r in highs[:25]:
            chk = r.get("check", "?")
            desc = (r.get("description") or "")[:140].replace("\n", " ")
            print(f"  - {chk}: {desc}", file=sys.stderr)
        if n > 25:
            print(f"  ... and {n - 25} more (contracts/core only)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
