import fitz
from pathlib import Path

source = Path("attached_assets/polestar-report-conflict-watch-202609140921_1789348933849.pdf")
output = Path(".agents/outputs/conflict-0921-pages")
output.mkdir(parents=True, exist_ok=True)

doc = fitz.open(source)
for index, page in enumerate(doc):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
    pixmap.save(output / f"page-{index + 1}.png")
print(f"Rendered {doc.page_count} pages to {output}")