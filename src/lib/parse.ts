import type { PageText } from "./chunk";

// Extract text from an uploaded file. PDFs are parsed page-by-page so we can
// attribute each chunk (and citation) to its source page.
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const isPdf =
    mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");

  if (isPdf) return parsePdf(buffer);

  // Plain text / markdown: treat as a single "page".
  const text = buffer.toString("utf-8");
  return { pages: [{ page: 1, text }], pageCount: 1 };
}

async function parsePdf(
  buffer: Buffer,
): Promise<{ pages: PageText[]; pageCount: number }> {
  // pdf-parse v2 exposes a class that returns per-page text (built on pdfjs).
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages: PageText[] = result.pages
      .map((p) => ({ page: p.num, text: p.text }))
      .filter((p) => p.text.trim().length > 0);

    // Fallback to the concatenated text if per-page came back empty.
    if (pages.length === 0 && result.text) {
      pages.push({ page: 1, text: result.text });
    }
    return { pages, pageCount: result.total || pages.length };
  } finally {
    await parser.destroy();
  }
}
