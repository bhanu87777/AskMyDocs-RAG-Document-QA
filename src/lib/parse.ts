import type { PageText } from "./chunk";
import { ocrPdfWithGemini } from "./ocr";

// Extract text from an uploaded file into per-"page" units so every chunk (and
// therefore every citation) can be attributed to a source location:
//   PDF        → one unit per page (OCR fallback for image/scanned PDFs)
//   Word       → one unit (documents aren't reliably paginated)
//   Excel/CSV  → one unit per row (cited as `Sheet "X" · Row N`)
//   PowerPoint → one unit per slide (cited as `Slide N`)
//   Text/MD    → one unit
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  const isPdf = mimeType === "application/pdf" || ext === "pdf";

  if (isPdf) return parsePdf(buffer);
  if (ext === "docx") return parseDocx(buffer);
  if (ext === "xlsx" || ext === "xls") return parseSpreadsheet(buffer, ext);
  if (ext === "csv") return parseSpreadsheet(buffer, "csv");
  if (ext === "pptx") return parsePptx(buffer);

  // Plain text / markdown: treat as a single "page".
  const text = buffer.toString("utf-8");
  return { pages: [{ page: 1, text }], pageCount: 1 };
}

// Minimum meaningful characters below which a PDF is treated as having no text
// layer (e.g. only page-separator artifacts survive) and OCR is attempted.
const PDF_TEXT_MIN_CHARS = 100;

async function parsePdf(
  buffer: Buffer,
): Promise<{ pages: PageText[]; pageCount: number }> {
  // pdf-parse v2 exposes a class that returns per-page text (built on pdfjs).
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let total = 0;
  let pages: PageText[] = [];
  try {
    const result = await parser.getText();
    total = result.total || 0;
    pages = result.pages
      .map((p) => ({ page: p.num, text: p.text }))
      .filter((p) => p.text.trim().length > 0);
  } finally {
    await parser.destroy();
  }

  const extractedChars = pages.reduce((n, p) => n + p.text.trim().length, 0);
  if (extractedChars >= PDF_TEXT_MIN_CHARS) {
    return { pages, pageCount: total || pages.length };
  }

  // No usable text layer → the PDF is scanned/image-based. OCR it.
  const ocrPages = await ocrPdfWithGemini(buffer);
  return { pages: ocrPages, pageCount: total || ocrPages.length };
}

async function parseDocx(
  buffer: Buffer,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  const text = value.trim();
  if (!text) throw new Error("No extractable text found in this Word document.");
  return { pages: [{ page: 1, text }], pageCount: 1 };
}

// Cap total data rows embedded from one workbook. Local embedding is CPU-bound,
// so very large sheets are truncated to keep ingestion responsive.
const MAX_SPREADSHEET_ROWS = 4000;

async function parseSpreadsheet(
  buffer: Buffer,
  ext: string,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });

  const pages: PageText[] = [];
  let rowsEmitted = 0;

  for (const sheetName of wb.SheetNames) {
    if (rowsEmitted >= MAX_SPREADSHEET_ROWS) break;
    const sheet = wb.Sheets[sheetName];
    // Array-of-arrays; blanks kept so column alignment with the header holds.
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    if (rows.length === 0) continue;

    const headers = (rows[0] ?? []).map((h) => String(h).trim());
    for (let r = 1; r < rows.length && rowsEmitted < MAX_SPREADSHEET_ROWS; r++) {
      const cells = rows[r] ?? [];
      const pairs: string[] = [];
      for (let c = 0; c < Math.max(headers.length, cells.length); c++) {
        const value = String(cells[c] ?? "").trim();
        if (!value) continue;
        const header = headers[c] || `Column ${c + 1}`;
        pairs.push(`${header}: ${value}`);
      }
      if (pairs.length === 0) continue; // skip fully-empty rows

      const rowNo = r + 1; // 1-indexed spreadsheet row (header is row 1)
      const label = `Sheet "${sheetName}" · Row ${rowNo}`;
      pages.push({ page: rowNo, text: `${label} — ${pairs.join("; ")}` });
      rowsEmitted++;
    }
  }

  if (pages.length === 0) {
    throw new Error(`No data rows found in this ${ext.toUpperCase()} file.`);
  }
  // "pageCount" for a workbook reads best as the number of sheets.
  return { pages, pageCount: wb.SheetNames.length };
}

// PowerPoint is a zip of `ppt/slides/slideN.xml`; text lives in <a:t> runs.
async function parsePptx(
  buffer: Buffer,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const pages: PageText[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const text = extractSlideText(xml);
    if (text.trim().length > 0) {
      pages.push({ page: slideNumber(name), text: `Slide ${slideNumber(name)} — ${text}` });
    }
  }

  if (pages.length === 0) {
    throw new Error("No extractable text found in this PowerPoint file.");
  }
  return { pages, pageCount: slideNames.length };
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

// Pull the text runs (<a:t>…</a:t>) out of a slide's XML, decoding entities.
// Paragraph boundaries (</a:p>) become newlines so bullets stay separated.
function extractSlideText(xml: string): string {
  const withBreaks = xml.replace(/<\/a:p>/g, "\n");
  const runs = [...withBreaks.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
    decodeXmlEntities(m[1]),
  );
  return runs
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
