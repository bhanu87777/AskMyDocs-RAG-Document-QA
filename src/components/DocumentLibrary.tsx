"use client";

import { useRef, useState } from "react";

export interface Doc {
  id: string;
  title: string;
  filename: string;
  status: "PROCESSING" | "READY" | "FAILED";
  pageCount: number;
  chunkCount: number;
  error: string | null;
}

const statusStyles: Record<Doc["status"], string> = {
  READY: "text-brand",
  PROCESSING: "text-amber-400",
  FAILED: "text-red-400",
};

export function DocumentLibrary({
  docs,
  selectedId,
  onSelect,
  onChanged,
}: {
  docs: Doc[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed");
      }
      const doc = (await res.json()) as Doc;
      if (doc.status === "FAILED") setError(doc.error || "Processing failed");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this document and its embeddings?")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (selectedId === id) onSelect(null);
    onChanged();
  }

  return (
    <aside className="flex w-full flex-col gap-3 sm:w-72 sm:shrink-0">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm transition hover:border-brand disabled:opacity-60"
      >
        {uploading ? (
          <span className="text-muted">Processing… (parsing + embedding)</span>
        ) : (
          <>
            <div className="text-2xl">＋</div>
            <div className="mt-1 font-medium">Upload a document</div>
            <div className="text-xs text-muted">PDF, TXT, or Markdown</div>
          </>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
        onChange={handleFile}
        className="hidden"
      />

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-border bg-surface p-2">
        <button
          onClick={() => onSelect(null)}
          className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition ${
            selectedId === null ? "bg-brand/15 text-brand" : "hover:bg-surface-2"
          }`}
        >
          🔍 All documents
          <span className="ml-1 text-xs text-muted">({docs.length})</span>
        </button>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {docs.map((d) => (
            <div
              key={d.id}
              onClick={() => d.status === "READY" && onSelect(d.id)}
              className={`group flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm transition ${
                selectedId === d.id ? "bg-brand/15" : "hover:bg-surface-2"
              } ${d.status !== "READY" ? "cursor-default opacity-70" : ""}`}
            >
              <span className="mt-0.5">📄</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.title}</div>
                <div className={`text-xs ${statusStyles[d.status]}`}>
                  {d.status === "READY"
                    ? `${d.pageCount} pages · ${d.chunkCount} chunks`
                    : d.status === "PROCESSING"
                      ? "Processing…"
                      : "Failed"}
                </div>
              </div>
              <button
                onClick={(e) => remove(d.id, e)}
                className="text-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
          {docs.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted">
              No documents yet. Upload one to start asking questions.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
