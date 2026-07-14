import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";

// Run the embedding model locally — no API key, no per-call cost. We use
// all-MiniLM-L6-v2 (384-dim), a small, fast sentence-embedding model. The model
// is downloaded from the Hugging Face hub once and cached on disk.
env.allowLocalModels = false;

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

// Cache the pipeline across hot-reloads / requests.
const globalForEmb = globalThis as unknown as {
  extractor?: Promise<FeatureExtractionPipeline>;
};

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!globalForEmb.extractor) {
    globalForEmb.extractor = pipeline("feature-extraction", EMBED_MODEL);
  }
  return globalForEmb.extractor;
}

// Embed a batch of texts into normalized vectors (mean-pooled).
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();

  // Process in small batches to keep memory bounded on large documents.
  const BATCH = 32;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  return vectors;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}
