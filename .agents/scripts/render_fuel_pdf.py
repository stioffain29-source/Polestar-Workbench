import fitz
from pathlib import Path
src = Path('attached_assets/polestar-report-fuel-watch-202609132033_1789302863513.pdf')
out = Path('.agents/outputs/fuel-pdf-audit')
doc = fitz.open(src)
print('pages', doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    path = out / f'page-{i+1}.png'
    pix.save(path)
    print(path, pix.width, pix.height)
