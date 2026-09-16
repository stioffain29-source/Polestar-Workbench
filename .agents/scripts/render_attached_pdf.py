from pathlib import Path
import pymupdf

source = Path("attached_assets/two-civilian-shootings-in-a-week-how-safe-is-the-trans-papua-r_1789567259390.pdf")
output = Path(".agents/outputs/spot-report-pages")
output.mkdir(parents=True, exist_ok=True)

doc = pymupdf.open(source)
print(f"pages={doc.page_count}")
for index, page in enumerate(doc):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
    target = output / f"page-{index + 1}.png"
    pix.save(target)
    print(target)