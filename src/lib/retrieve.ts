import { prisma } from "./prisma";
import { embedOne } from "./embeddings";
import { cosine } from "./similarity";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  page: number | null;
  content: string;
  score: number;
}

// Retrieve the top-k most relevant chunks for a question, scoped to a user's
// documents (optionally a single document). We load candidate chunks and rank
// them by cosine similarity in memory — simple and fully explainable at this
// scale. (At larger scale you'd push this into an ANN index / MySQL VECTOR.)
export async function retrieve(
  userId: string,
  question: string,
  { documentId, topK = 5 }: { documentId?: string; topK?: number } = {},
): Promise<RetrievedChunk[]> {
  const qVec = await embedOne(question);

  const chunks = await prisma.chunk.findMany({
    where: {
      document: {
        userId,
        status: "READY",
        ...(documentId ? { id: documentId } : {}),
      },
    },
    select: {
      id: true,
      documentId: true,
      page: true,
      content: true,
      embedding: true,
      document: { select: { title: true } },
    },
  });

  const scored = chunks.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentTitle: c.document.title,
    page: c.page,
    content: c.content,
    score: cosine(qVec, c.embedding as number[]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
