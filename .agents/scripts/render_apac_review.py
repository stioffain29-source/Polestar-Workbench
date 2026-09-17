try:
    import fitz
except Exception as exc:
    print(f'PyMuPDF unavailable: {exc}')
    raise SystemExit(0)
doc = fitz.open('/tmp/apac-weekly-review/apac-weekly.pdf')
for index, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False)
    pix.save(f'.agents/outputs/apac-page-{index+1}.png')
print(f'rendered {doc.page_count} pages')
