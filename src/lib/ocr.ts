import type { PageText } from "./chunk";
import { GEMINI_MODELS } from "./answer";

// OCR fallback for PDFs with no extractable text layer (scanned pages, or
// "printed to PDF" documents whose text is rendered as vector/image glyphs).
// We send the whole PDF to Gemini (which reads it natively) and ask for a plain
// transcription with per-page markers, so each page still becomes its own
// citable unit. Reuses the same free GEMINI_API_KEY the answer path uses.

const PAGE_MARKER = /^===\s*PAGE\s+(\d+)\s*===\s*$/i;

const OCR_PROMPT = `Transcribe ALL readable text from this PDF, in natural reading order.
Rules:
- Before each page's text, output a line exactly like: === PAGE n ===  (n = the page number, starting at 1).
- Include headings, body text, table contents, and captions. Preserve line breaks between paragraphs.
- Do NOT add commentary, summaries, or descriptions of images — output only the transcribed text.
- If a page has no text, still output its === PAGE n === marker followed by a blank line.`;

export async function ocrPdfWithGemini(buffer: Buffer): Promise<PageText[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "This PDF has no extractable text (it looks scanned or image-based). " +
        "Set GEMINI_API_KEY in .env to enable OCR, or upload a text-based file.",
    );
  }

  // Free-tier daily quotas are per model, so on quota/availability errors
  // (429/404/503) the same request is retried on the next model in
  // GEMINI_MODELS before giving up.
  let res: Response | null = null;
  let lastError = "";
  for (const candidate of GEMINI_MODELS) {
    const attempt = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } },
                { text: OCR_PROMPT },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 8192 },
        }),
      },
    );
    if (attempt.ok) {
      res = attempt;
      break;
    }
    const detail = await attempt.text().catch(() => "");
    lastError = `OCR failed (Gemini ${attempt.status}, ${candidate}): ${detail.slice(0, 300)}`;
    if (![429, 404, 503].includes(attempt.status)) break;
  }
  if (!res) {
    throw new Error(lastError || "OCR failed: no Gemini model available");
  }

  const json = await res.json();
  const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("OCR returned no text for this PDF.");
  }

  return splitByPageMarker(text);
}

// Split the transcription on "=== PAGE n ===" markers into per-page units.
// Falls back to a single page if the model didn't emit markers.
function splitByPageMarker(text: string): PageText[] {
  const pages: PageText[] = [];
  let currentPage = 1;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) pages.push({ page: currentPage, text: body });
    buffer = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const marker = line.trim().match(PAGE_MARKER);
    if (marker) {
      flush();
      currentPage = Number(marker[1]) || currentPage + 1;
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (pages.length === 0) return [{ page: 1, text }];
  return pages;
}
