from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / ".agents" / "outputs" / "regional-pdf-review"
PDFS = {
    "apac": ROOT / "artifacts" / "workbench" / "exports" / "Polestar-APAC-Weekly-2026-09-20.pdf",
    "middle-east": ROOT / "artifacts" / "workbench" / "exports" / "Polestar-Middle-East-Weekly-2026-09-20.pdf",
}


OUTPUT.mkdir(parents=True, exist_ok=True)
for slug, pdf_path in PDFS.items():
    document = fitz.open(pdf_path)
    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
        pixmap.save(OUTPUT / f"{slug}-page-{index + 1}.png")
    document.close()