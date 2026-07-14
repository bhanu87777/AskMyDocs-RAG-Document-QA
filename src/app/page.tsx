import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/chat");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-3xl">
        📄
      </div>
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        Chat with your documents — <span className="text-brand">with citations</span>.
      </h1>
      <p className="mt-4 max-w-xl text-muted">
        Upload PDFs, manuals, or contracts and ask questions in plain English.
        AskMyDocs answers from your files and cites the exact source passage —
        so you can trust every answer.
      </p>
      <div className="mt-8">
        <Link
          href="/login"
          className="rounded-lg bg-brand px-6 py-3 font-medium text-brand-fg transition hover:opacity-90"
        >
          Try it now →
        </Link>
      </div>
      <div className="mt-16 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
        {[
          {
            t: "Local embeddings",
            d: "Documents are embedded on-device with a transformers.js model — no embedding API needed.",
          },
          {
            t: "Grounded answers",
            d: "Answers use only your documents. If it's not in your files, it says so.",
          },
          {
            t: "Real citations",
            d: "Every answer links back to the source document and page it came from.",
          },
        ].map((f) => (
          <div key={f.t} className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium">{f.t}</h3>
            <p className="mt-1 text-sm text-muted">{f.d}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
