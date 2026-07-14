import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestDocument } from "../src/lib/ingest";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding AskMyDocs…");

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const user = await prisma.user.upsert({
    where: { email: "demo@askmydocs.app" },
    update: {},
    create: {
      email: "demo@askmydocs.app",
      name: "Demo User",
      password: passwordHash,
    },
  });

  // Start clean so re-seeding is idempotent.
  await prisma.document.deleteMany({ where: { userId: user.id } });

  const filename = "acme-employee-handbook.md";
  const content = readFileSync(join(__dirname, "sample-handbook.md"));

  const doc = await prisma.document.create({
    data: {
      userId: user.id,
      title: "Acme Corp Employee Handbook (2026)",
      filename,
      mimeType: "text/markdown",
      status: "PROCESSING",
    },
  });

  console.log("Ingesting sample document (downloads the embedding model on first run)…");
  const result = await ingestDocument(doc.id, content, "text/markdown", filename);

  console.log(`Ingested "${doc.title}": ${result.chunkCount} chunks embedded.`);
  console.log("Login: demo@askmydocs.app / demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
