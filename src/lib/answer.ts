import type { RetrievedChunk } from "./retrieve";

export { ANSWER_DELIMITER } from "./constants";

export const ANSWER_MODEL = process.env.ANSWER_MODEL || "claude-sonnet-5";

// Gemini model used when GEMINI_API_KEY is set (free tier via Google AI Studio).
// "gemini-flash-latest" tracks the current free flash model.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Free-tier daily quotas are counted PER MODEL, so each entry below is a
// separate quota bucket. When the preferred model is exhausted (429) or
// unavailable (404/503), callers retry the same request on the next one
// before falling back to the extractive answer.
export const GEMINI_MODELS = [
  ...new Set([
    GEMINI_MODEL,
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
  ]),
];

export interface Citation {
  n: number;
  documentId: string;
  documentTitle: string;
  page: number | null;
  snippet: string;
  score: number;
}

export function toCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    n: i + 1,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    page: c.page,
    snippet: c.content.slice(0, 240) + (c.content.length > 240 ? "…" : ""),
    score: Math.round(c.score * 1000) / 1000,
  }));
}

// Numbered source context the model must ground its answer in.
export function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] (from "${c.documentTitle}"${c.page ? `, p.${c.page}` : ""})\n${c.content}`,
    )
    .join("\n\n");
}

export const SYSTEM_PROMPT = `You are AskMyDocs, a precise assistant that answers questions strictly from the user's uploaded documents.

Rules:
- Answer ONLY using the numbered sources provided. Do not use outside knowledge.
- Cite the sources you used inline with bracketed numbers like [1] or [2][3].
- If the answer isn't in the sources, say: "I couldn't find that in your documents." Do not guess.
- Be concise and direct.`;

// Fallback when no AI key is set (or the AI service errored): return the most
// relevant passages verbatim so the app still demonstrates end-to-end retrieval.
export function extractiveAnswer(
  chunks: RetrievedChunk[],
  header = "**No AI key configured — showing the most relevant passages I retrieved:**",
): string {
  if (chunks.length === 0) {
    return "I couldn't find anything relevant in your documents.";
  }
  const top = chunks.slice(0, 3);
  return (
    header +
    "\n\n" +
    top
      .map((c, i) => `> [${i + 1}] ${c.content}`)
      .join("\n\n")
  );
}

export function userPrompt(question: string, chunks: RetrievedChunk[]): string {
  return `Sources:\n\n${buildContext(chunks)}\n\n---\n\nQuestion: ${question}\n\nAnswer using only the sources above, citing them with [n].`;
}
