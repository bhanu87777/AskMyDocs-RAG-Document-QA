import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { ingestDocument } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120; // ingestion + first model download can be slow

// GET /api/documents — list the current user's documents.
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(documents);
}

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED = ["application/pdf", "text/plain", "text/markdown"];

// POST /api/documents — upload a file and run the RAG ingestion pipeline.
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
  }

  const name = file.name || "document";
  const isTextExt = /\.(txt|md|markdown)$/i.test(name);
  const isPdfExt = /\.pdf$/i.test(name);
  if (!ALLOWED.includes(file.type) && !isTextExt && !isPdfExt) {
    return NextResponse.json(
      { error: "Only PDF, TXT, and Markdown files are supported" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const title = (form?.get("title") as string) || name.replace(/\.[^.]+$/, "");

  const doc = await prisma.document.create({
    data: {
      userId,
      title,
      filename: name,
      mimeType: file.type || (isPdfExt ? "application/pdf" : "text/plain"),
      status: "PROCESSING",
    },
  });

  try {
    await ingestDocument(doc.id, buffer, doc.mimeType, name);
  } catch {
    // Status is already set to FAILED inside ingestDocument; return the row.
    const failed = await prisma.document.findUnique({ where: { id: doc.id } });
    return NextResponse.json(failed, { status: 201 });
  }

  const ready = await prisma.document.findUnique({ where: { id: doc.id } });
  return NextResponse.json(ready, { status: 201 });
}
