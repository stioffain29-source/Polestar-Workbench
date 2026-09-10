#!/usr/bin/env python3
"""Steve send-readiness checklist for a Flashpoint PDF (Sprint 1b + 1c).

Usage:
  python artifacts/workbench/scripts/validateSteveFlashpointChecklist.py path/to/report.pdf
  python artifacts/workbench/scripts/validateSteveFlashpointChecklist.py path/to/report.pdf --issue 2026-09-07

Exits 0 when all checks pass, 1 otherwise.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("ERROR: pip install pypdf")
    sys.exit(2)


HYGIENE_FAIL = [
    (r"\bfusion\b.{0,40}\b(reactor|project|energy|tokamak)\b", "fusion/science row in PDF"),
    (r"\banti-gang\b|\bgang (?:war|shootout|violence)\b", "gang/security story (verify protest relevance)"),
    (r"\bSouth Korea US Protest\b", "raw-feed title"),
    (r"\bBangladesh US Protest\b", "raw-feed title"),
    (r"Scott Kuggeleijn|Super Smash", "sports/entertainment slop"),
    (r"messages of support from Myanmar citizens after protest", "commentary/sympathy row"),
    (r"\bprotest in London\b|\bprotest in Washington\b|\bLondon embassy\b.*\bprotest\b", "diaspora mis-location (spot-check)"),
]

EDITORIAL_FAIL = [
    (r"\bdriven by\b.{0,60}\bmostly\b", "dataset narration (driven by … mostly)"),
    (r"\bmostly protests and organised action\b", "Steve-flagged template phrase"),
    (r"\bprotests and organised action\b", "forecast mix template"),
    (r"\bcity-centre commercial districts\b", "generic activism location template"),
    (r"\bone reporting period\b", "period-machinery forecast"),
    (r"\bconfirmed dates in Watch Next\b", "Watch Next treated as a calendar"),
    (r"\bupcoming,\s*date confirmed\b", "Watch Next date-calendar status"),
    (r"\b(?:the )?(?:table|chart) (?:above|below)\b", "file/table narration"),
    (r"\bincidents listed in the tables above\b", "file/table narration"),
    (r"\bdriven by protest activity\b", "dataset narration"),
    (r"\bsections follow\b", "meta section preview"),
    (r"\bOverall protest posture this week\b", "posture-score explanation"),
    (r"\bposture weighs volume\b", "posture-score explanation"),
    (r"\bRisk level:\s*(?:Insignificant|Low|Moderate|High|Extreme)\b", "Risk level label in Polestar View"),
    (r"\bthe practical risk this week was\b", "generic What Matters opener"),
    (r"\bactivity is being driven by\b", "banned template"),
    (r"\boperating posture\b", "banned template"),
    (r"\bthe week reads as\b", "banned template"),
]

SECTION_MARKERS = [
    ("Executive Summary", r"Executive Summary"),
    ("Country View", r"Regional and Country View|Country View|Regional View"),
    ("What Matters", r"What Matters"),
    ("Polestar View", r"Polestar View"),
]

NEXT_SECTION_HEADING = re.compile(
    r"\n(?:WHAT MATTERS|IMPLICATIONS FOR BUSINESS|WATCH NEXT|POLESTAR VIEW|RELATED INCIDENTS|"
    r"EXECUTIVE SUMMARY|FAST FACTS|ACTIVISM|CIVIL UNREST|FORECAST|REGIONAL AND COUNTRY VIEW|DISCLAIMER)\b",
    re.I,
)


def extract_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    parts: list[str] = []
    for page in reader.pages:
        t = page.extract_text() or ""
        parts.append(t)
    return "\n".join(parts)


def section_text(full: str, pattern: str) -> str:
    m = re.search(pattern, full, re.I)
    if not m:
        return ""
    rest = full[m.end() :]
    end_m = NEXT_SECTION_HEADING.search(rest)
    chunk = rest[: end_m.start()] if end_m else rest[:2500]
    return chunk.strip()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    pdf_path = Path(sys.argv[1]).expanduser().resolve()
    if not pdf_path.is_file():
        print(f"ERROR: file not found: {pdf_path}")
        return 2

    issue = None
    if "--issue" in sys.argv:
        i = sys.argv.index("--issue")
        if i + 1 < len(sys.argv):
            issue = sys.argv[i + 1]

    text = extract_text(pdf_path)
    if len(text.strip()) < 200:
        print("ERROR: PDF text extraction returned very little text — may be image-only or corrupt")
        return 2

    passed: list[str] = []
    failed: list[str] = []
    warn: list[str] = []

    # Process
    if issue:
        if issue in text:
            passed.append(f"Issue date {issue} appears in PDF")
        else:
            warn.append(f"Issue date {issue} not found in extracted text — confirm reporting period manually")
    if re.search(r"2026-09-0[78]", text):
        passed.append("Reporting period looks like Steve fixture week (Sep 2026)")

    # Hygiene
    hygiene_hits = []
    for pat, label in HYGIENE_FAIL:
        if re.search(pat, text, re.I):
            hygiene_hits.append(label)
    if hygiene_hits:
        failed.append("Hygiene: possible slop still present — " + "; ".join(hygiene_hits))
    else:
        passed.append("Hygiene: no obvious slop patterns in PDF text")

    # Editorial banned phrases (whole doc)
    editorial_hits = []
    for pat, label in EDITORIAL_FAIL:
        if re.search(pat, text, re.I):
            editorial_hits.append(label)
    if editorial_hits:
        failed.append("Editorial: banned/template phrasing — " + "; ".join(editorial_hits))
    else:
        passed.append("Editorial: no banned template phrases detected")

    sections = {name: section_text(text, pat) for name, pat in SECTION_MARKERS}
    missing = [n for n, s in sections.items() if not s]
    if missing:
        warn.append("Could not locate section headings: " + ", ".join(missing))

    exec_s = sections.get("Executive Summary", "")
    country_s = sections.get("Country View", "")
    wm_s = sections.get("What Matters", "")
    pole_s = sections.get("Polestar View", "")

    if exec_s and re.search(r"sections follow|Detailed activism", exec_s, re.I):
        failed.append("Executive Summary contains meta filler")
    elif exec_s:
        passed.append("Executive Summary: no 'sections follow' filler")

    if country_s and re.search(r"\bdriven by\b.{0,40}\bmostly\b", country_s, re.I):
        failed.append("Country View still uses driven-by/mostly template")
    elif country_s:
        passed.append("Country View: no driven-by/mostly template")

    if pole_s and re.search(r"^Risk level:", pole_s, re.I | re.M):
        failed.append("Polestar View opens with Risk level:")
    elif pole_s and re.search(r"journey|transport|freight|movement|Watch Next|flexible", pole_s, re.I):
        passed.append("Polestar View: actionable movement guidance present")

    if wm_s and re.search(r"the practical risk this week was", wm_s, re.I):
        failed.append("What Matters uses generic opener")
    elif wm_s:
        passed.append("What Matters: no generic practical-risk opener")

    # Cross-section duplicate sentences (>= 50 chars)
    client = {"Executive Summary": exec_s, "Country View": country_s, "What Matters": wm_s, "Polestar View": pole_s}
    owners: dict[str, str] = {}
    for name, block in client.items():
        if not block:
            continue
        for sent in re.split(r"(?<=[.!?])\s+", block):
            s = sent.strip()
            if len(s) < 50:
                continue
            key = s.lower()
            if key in owners and owners[key] != name:
                failed.append(
                    f"Section repetition: same sentence in {owners[key]} and {name}: {s[:70]}…"
                )
            else:
                owners[key] = name
    if not any("Section repetition" in f for f in failed):
        passed.append("Section distinctness: no repeated long sentences across client sections")

    # Fast facts parity hint
    m_distinct = re.search(r"Distinct Incidents[^\d]*(\d+)", text, re.I)
    if m_distinct:
        passed.append(f"Fast Facts Distinct Incidents = {m_distinct.group(1)} (verify matches table row count manually)")

    print(f"\nSteve Flashpoint checklist — {pdf_path.name}\n{'=' * 60}")
    for p in passed:
        print(f"  PASS  {p}")
    for w in warn:
        print(f"  WARN  {w}")
    for f in failed:
        print(f"  FAIL  {f}")

    print(f"\n{'=' * 60}")
    if failed:
        print("RESULT: NOT READY — fix failures before sending to Steve")
        return 1
    if warn:
        print("RESULT: LIKELY READY — review warnings, then send to Steve")
        return 0
    print("RESULT: READY — send to Steve for feedback")
    return 0


if __name__ == "__main__":
    sys.exit(main())
