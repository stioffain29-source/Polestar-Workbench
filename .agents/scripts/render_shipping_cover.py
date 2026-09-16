import fitz

source = "attached_assets/polestar-report-shipping-watch-202609161133_1789530332428.pdf"
output = ".agents/outputs/shipping-watch-reference-cover.png"

document = fitz.open(source)
page = document[0]
pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
pixmap.save(output)
print(output)