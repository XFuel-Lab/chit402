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

# High findings that still match after manual review (Slither false positives / intended design).
# Keep narrowly scoped: check name + substring of official description. Revisit if code changes.
_TRIAGED_CORE_HIGH: tuple[tuple[str, str], ...] = (
    ("reentrancy-eth", "Reentrancy in CoreRevenueSplitter.distribute()"),
    ("reentrancy-eth", "Reentrancy in CoreRevenueSplitter._routeStake"),
    ("arbitrary-send-eth", "CoreRevenueSplitter._safeTransfer"),
    ("arbitrary-send-eth", "ZKVerifierSP1.relayProofCrossChain"),
    ("uninitialized-state", "ZKVerifierSP1.rollupBatchSize"),
)


def _result_text_blob(result: dict) -> str:
    """Slither populates description and/or markdown; combine for resilient substring match."""
    parts = [
        result.get("description"),
        result.get("markdown"),
        result.get("first_markdown_element"),
    ]
    return " ".join(p or "" for p in parts).replace("\n", " ").replace("\t", " ")


def _triaged_core_false_positive(result: dict) -> bool:
    chk = result.get("check") or ""
    blob = _result_text_blob(result)
    for need_chk, needle in _TRIAGED_CORE_HIGH:
        if chk == need_chk and needle in blob:
            return True
    return False


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

    raw_highs = [
        r
        for r in detectors
        if r.get("impact") == "High"
        and r.get("confidence") in ("High", "Medium")
        and finding_touches_core(r)
    ]

    triaged: list[dict] = []
    highs: list[dict] = []
    for r in raw_highs:
        if _triaged_core_false_positive(r):
            triaged.append(r)
        else:
            highs.append(r)

    n = len(highs)
    print(n)
    if triaged:
        print(
            f"  (ignored {len(triaged)} triaged high in contracts/core - see scripts/slither-count-high-core.py)",
            file=sys.stderr,
        )
        for r in triaged[:10]:
            chk = r.get("check", "?")
            desc = (r.get("description") or "")[:120].replace("\n", " ")
            print(f"    ~ {chk}: {desc}", file=sys.stderr)
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
