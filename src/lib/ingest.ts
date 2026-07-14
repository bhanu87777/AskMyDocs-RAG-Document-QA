import { prisma } from "./prisma";
import { parseDocument } from "./parse";
import { chunkPages } from "./chunk";
import { embed } from "./embeddings";
import type { Prisma } from "@prisma/client";

// Full ingestion pipeline for one document: parse → chunk → embed → store.
// Updates the document status to READY (or FAILED with an error message).
export async function ingestDocument(
  documentId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<{ chunkCount: number; pageCount: number }> {
  try {
    const { pages, pageCount } = await parseDocument(buffer, mimeType, filename);
    const rawChunks = chunkPages(pages);

    if (rawChunks.length === 0) {
      throw new Error("No extractable text found in this document.");
    }

    const vectors = await embed(rawChunks.map((c) => c.content));

    await prisma.chunk.createMany({
      data: rawChunks.map((c, i) => ({
        documentId,
        idx: i,
        page: c.page,
        content: c.content,
        embedding: vectors[i] as unknown as Prisma.InputJsonValue,
      })),
    });

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "READY", pageCount, chunkCount: rawChunks.length },
    });

    return { chunkCount: rawChunks.length, pageCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed";
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "FAILED", error: message },
    });
    throw err;
  }
}
