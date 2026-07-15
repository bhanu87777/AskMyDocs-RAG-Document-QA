// Embeddings via Google's Gemini API (gemini-embedding-001, 768-dim).
//
// We compute embeddings through a hosted API rather than a local model
// (transformers.js + onnxruntime) so the app runs on Vercel's serverless
// functions without bundling the ~200 MB ONNX runtime — which exceeds Vercel's
// function size limit. Reuses the same free GEMINI_API_KEY the answer/OCR paths
// use. Documents and queries are embedded with the matching RAG task types.

const EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
export const EMBED_MODEL = "gemini-embedding-001";
// gemini-embedding-001 defaults to 3072 dims but supports Matryoshka
// truncation; 768 keeps stored JSON vectors small. cosine() normalizes both
// sides, so the (un-normalized) truncated vectors compare correctly.
export const EMBED_DIM = 768;

// Modest concurrency: fast enough for a document's worth of chunks while
// staying under the free tier's per-minute request limits.
const CONCURRENCY = 4;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is required to compute embeddings. Set it in your " +
        "environment (Google AI Studio, free — no credit card).",
    );
  }
  return key;
}

async function embedText(text: string, taskType: TaskType, key: string): Promise<number[]> {
  const res = await fetch(
    `${EMBED_ENDPOINT}/models/${EMBED_MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBED_DIM,
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Embedding failed (Gemini ${res.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = await res.json();
  const values = json?.embedding?.values as number[] | undefined;
  if (!values || values.length !== EMBED_DIM) {
    throw new Error(
      `Embedding returned unexpected shape (got ${values?.length ?? 0} dims).`,
    );
  }
  return values;
}

// Embed a batch of texts into vectors, preserving input order. Runs a bounded
// number of requests concurrently.
export async function embed(
  texts: string[],
  taskType: TaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = apiKey();

  const vectors: number[][] = new Array(texts.length);
  let next = 0;
  async function worker() {
    while (next < texts.length) {
      const i = next++;
      vectors[i] = await embedText(texts[i], taskType, key);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker),
  );
  return vectors;
}

export async function embedOne(
  text: string,
  taskType: TaskType = "RETRIEVAL_QUERY",
): Promise<number[]> {
  const [vec] = await embed([text], taskType);
  return vec;
}
