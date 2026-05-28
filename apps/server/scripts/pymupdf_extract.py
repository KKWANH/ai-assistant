#!/usr/bin/env python3
"""
pymupdf_extract — convert a PDF to markdown using pymupdf4llm.

Wrapper script invoked by apps/server/src/services/pymupdf.ts. Reads
the input PDF path from argv, writes markdown to stdout.

Why a wrapper script (instead of calling pymupdf4llm CLI):
  * pymupdf4llm doesn't ship a stable CLI — only a Python API.
  * Importing into the long-lived Node process via `python-bridge` would
    require a Python embed, doubling the install complexity.
  * Subprocess + stdout is the simplest, language-agnostic boundary.

Why pymupdf for Korean PDFs:
  * pdfminer (markitdown's default backend) is known to mis-decode
    Korean font CMaps from HWP-origin PDFs — typical symptom is mojibake
    or all-spaces output where Korean glyphs should be.
  * PyMuPDF's MuPDF engine handles CJK font subsetting much more
    reliably, especially for documents created by Hancom Office.

Exit codes:
  0 — success, markdown on stdout
  1 — bad arguments
  2 — file not found
  3 — PDF parse error
"""
import sys
import os


def main():
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <pdf-path>", file=sys.stderr)
        sys.exit(1)
    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        print(f"not found: {pdf_path}", file=sys.stderr)
        sys.exit(2)
    try:
        # Import lazily so --help / argument errors don't pay the import cost.
        import pymupdf4llm  # type: ignore
        md = pymupdf4llm.to_markdown(pdf_path)
        # to_markdown returns a single str; write once to avoid stdout
        # interleaving with anything else.
        sys.stdout.write(md)
    except Exception as e:
        print(f"pymupdf extract failed: {e}", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
