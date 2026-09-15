import fitz
from pathlib import Path
src = Path('attached_assets/polestar-report-flashpoint-202609152157_1789480715559.pdf')
out = Path('.agents/outputs/flashpoint-pdf')
doc = fitz.open(src)
print(f'pages={doc.page_count}')
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    dest = out / f'page-{i+1}.png'
    pix.save(dest)
    print(dest)
