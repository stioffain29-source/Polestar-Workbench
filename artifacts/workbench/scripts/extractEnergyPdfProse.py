"""Extract the attached Energy PDF's prose for read-only layout regression.

Uses installed Poppler rather than changing application dependencies.
Usage: python scripts/extractEnergyPdfProse.py <pdf> <output-json> <issue-date>
"""
import json
import re
import subprocess
import sys

pdf, output, issue_date = sys.argv[1:]
text = subprocess.check_output(["pdftotext", "-layout", pdf, "-"], text=True)
lines = [
    line.strip() for line in text.splitlines()
    if not re.search(r"polestar-advisory\.com|info@polestar|Page \d+ of \d+", line)
    and line.strip() != "ENERGY WATCH"
]
text = "\n".join(lines)

def prose_between(start, end):
    body = text.split(start, 1)[1].split(end, 1)[0]
    return "\n\n".join(
        re.sub(r"\s+", " ", paragraph).strip()
        for paragraph in re.split(r"\n\s*\n", body)
        if paragraph.strip()
    )

def list_between(start, end):
    # The PDF already contains a bullet glyph. Restore one source marker,
    # rather than adding "- " in front of it and printing a doubled bullet.
    return "\n".join(
        "- " + re.sub(r"^(?:[-*•]\s*)+", "", paragraph)
        for paragraph in prose_between(start, end).split("\n\n")
    )

# The first Energy Situation is the map caption; the second is body prose.
body = text.split("ENERGY SITUATION", 2)[2].split("WHAT MATTERS", 1)[0]
situation = "\n\n".join(
    re.sub(r"\s+", " ", paragraph).strip()
    for paragraph in re.split(r"\n\s*\n", body)
    if paragraph.strip()
)
# Preserve the printed geography headings as headings rather than welding
# their words into the following paragraph.
situation = re.sub(
    r"(BANGLADESH / DHAKA|PHILIPPINES / VISAYAS) ",
    r"\1\n\n",
    situation,
)
payload = {
    "issueDate": issue_date,
    "executiveSummary": prose_between("BLUF", "ENERGY SITUATION"),
    "situation": situation,
    "whatHappened": "",
    "whatMatters": prose_between("WHAT MATTERS", "IMPLICATIONS FOR BUSINESS"),
    "implications": list_between("IMPLICATIONS FOR BUSINESS", "WATCH NEXT"),
    "watchNext": list_between("WATCH NEXT", "POLESTAR VIEW"),
    "polestarView": prose_between("POLESTAR VIEW", "DISCLAIMER"),
}
with open(output, "w") as file:
    json.dump(payload, file, indent=2)