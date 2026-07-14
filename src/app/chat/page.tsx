import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { Navbar } from "@/components/Navbar";
import { Workspace } from "@/components/Workspace";
import type { Doc } from "@/components/DocumentLibrary";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const initialDocs: Doc[] = documents.map((d) => ({
    id: d.id,
    title: d.title,
    filename: d.filename,
    status: d.status,
    pageCount: d.pageCount,
    chunkCount: d.chunkCount,
    error: d.error,
  }));

  return (
    <>
      <Navbar />
      <Workspace initialDocs={initialDocs} />
    </>
  );
}
