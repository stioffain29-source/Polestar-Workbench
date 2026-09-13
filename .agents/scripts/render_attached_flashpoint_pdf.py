import fitz
from pathlib import Path

source = Path("attached_assets/polestar-report-flashpoint-202609131220_1789273269185.pdf")
output = Path(".agents/outputs/flashpoint-pdf")
output.mkdir(parents=True, exist_ok=True)

doc = fitz.open(source)
for index, page in enumerate(doc):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pixmap.save(output / f"page-{index + 1}.png")

print(f"rendered {doc.page_count} pages to {output}")