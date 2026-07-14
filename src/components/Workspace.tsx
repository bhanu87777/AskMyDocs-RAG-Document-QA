"use client";

import { useState } from "react";
import { DocumentLibrary, type Doc } from "./DocumentLibrary";
import { ChatPanel } from "./ChatPanel";

export function Workspace({ initialDocs }: { initialDocs: Doc[] }) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/documents");
    if (res.ok) setDocs(await res.json());
  }

  const readyDocs = docs.filter((d) => d.status === "READY");
  const scopeLabel = selectedId
    ? docs.find((d) => d.id === selectedId)?.title ?? "a document"
    : `All documents (${readyDocs.length})`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-6 sm:flex-row">
      <DocumentLibrary
        docs={docs}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={refresh}
      />
      <ChatPanel
        selectedId={selectedId}
        scopeLabel={scopeLabel}
        hasDocs={readyDocs.length > 0}
      />
    </div>
  );
}
