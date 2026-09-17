from pathlib import Path

import pymupdf


PDF_PATH = Path("artifacts/workbench/screenshots/apac-weekly-review-2026-09-17.pdf")
OUTPUT_DIR = Path(".agents/outputs/apac-weekly-review")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(PDF_PATH)
    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
        pixmap.save(OUTPUT_DIR / f"page-{index + 1}.png")
    print(f"Rendered {document.page_count} pages to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()