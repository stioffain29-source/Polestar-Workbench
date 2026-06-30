#!/usr/bin/env python3
"""Per-page Tf-operator font inventory for jsPDF-exported PDFs.

jsPDF auto-registers the 14 standard PDF fonts in each page's font dictionary,
so merely listing /Font resources (e.g. `pdffonts`) cannot prove font cleanliness.
The only safe check is which font resource is actually SELECTED by a `Tf` operator
in the page content stream. This resolves every Tf font name back to its BaseFont
and reports any non-Roboto selection. PASS = no non-Roboto font is ever selected.

Usage:
    python3 fontAuditTf.py "Label::/abs/path.pdf" ["Label2::/abs/path2.pdf" ...]
Each argument is "<section label>::<pdf path>". Prints an audit block per PDF.
"""
import re
import sys
from pypdf import PdfReader
from pypdf.generic import IndirectObject


def base_font_of(font_obj):
    obj = font_obj.get_object() if isinstance(font_obj, IndirectObject) else font_obj
    bf = obj.get("/BaseFont")
    name = str(bf) if bf is not None else "<unknown>"
    return name.lstrip("/").split("+")[-1]


def tf_used_fonts(page):
    """Return the sorted set of BaseFonts selected via Tf in this page."""
    resources = page.get("/Resources")
    resources = resources.get_object() if isinstance(resources, IndirectObject) else resources
    fonts = {}
    if resources is not None and "/Font" in resources:
        font_dict = resources["/Font"]
        font_dict = font_dict.get_object() if isinstance(font_dict, IndirectObject) else font_dict
        for res_name, font_ref in font_dict.items():
            fonts[res_name.lstrip("/")] = base_font_of(font_ref)
    data = page.get_contents()
    content = data.get_data().decode("latin-1") if data is not None else ""
    used = set()
    for m in re.finditer(r"/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf", content):
        res = m.group(1)
        used.add(fonts.get(res, f"<unmapped:{res}>"))
    return sorted(used)


def audit(label, path):
    reader = PdfReader(path)
    lines = [f"==== {label} ===="]
    all_used = set()
    for idx, page in enumerate(reader.pages, start=1):
        used = tf_used_fonts(page)
        all_used.update(used)
        lines.append(f"  page {idx}: Tf-used fonts = {used}")
    non_roboto = sorted(f for f in all_used if not f.startswith("Roboto"))
    lines.append(f"  --> ALL fonts USED via Tf: {sorted(all_used)}")
    verdict = "NONE — PASS" if not non_roboto else f"{non_roboto} — FAIL"
    lines.append(f"  --> NON-Roboto used: {verdict}")
    return "\n".join(lines), not non_roboto


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    blocks = []
    ok = True
    for arg in sys.argv[1:]:
        label, _, path = arg.partition("::")
        block, passed = audit(label, path)
        blocks.append(block)
        ok = ok and passed
    print("\n\n".join(blocks))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
