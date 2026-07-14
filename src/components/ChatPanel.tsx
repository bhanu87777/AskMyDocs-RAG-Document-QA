"use client";

import { useRef, useState, useEffect } from "react";
import { ANSWER_DELIMITER } from "@/lib/constants";

interface Citation {
  n: number;
  documentId: string;
  documentTitle: string;
  page: number | null;
  snippet: string;
  score: number;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  streaming?: boolean;
}

const SUGGESTIONS = [
  "How many vacation days do I get?",
  "What is the password policy?",
  "What is the 401k company match?",
];

export function ChatPanel({
  selectedId,
  scopeLabel,
  hasDocs,
}: {
  selectedId: string | null;
  scopeLabel: string;
  hasDocs: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", text: question },
      { role: "assistant", text: "", streaming: true },
    ]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, documentId: selectedId ?? undefined }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let citations: Citation[] | undefined;

      // Stream: <citations JSON> + DELIMITER + <answer text…>
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });

        const i = full.indexOf(ANSWER_DELIMITER);
        if (i >= 0) {
          if (!citations) {
            try {
              citations = JSON.parse(full.slice(0, i)).citations as Citation[];
            } catch {
              citations = [];
            }
          }
          const answer = full.slice(i + ANSWER_DELIMITER.length);
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = {
              role: "assistant",
              text: answer,
              citations,
              streaming: true,
            };
            return next;
          });
        }
      }

      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, streaming: false };
        return next;
      });
    } catch {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          text: "Something went wrong answering that. Please try again.",
          streaming: false,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-1 flex-col rounded-2xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-3 text-sm text-muted">
        Asking:{" "}
        <span className="font-medium text-foreground">{scopeLabel}</span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-10 text-center">
            <div className="text-4xl">💬</div>
            <h2 className="mt-3 text-lg font-medium">Ask your documents anything</h2>
            <p className="mt-1 text-sm text-muted">
              Answers are grounded in your files, with citations to the source.
            </p>
            {hasDocs && (
              <div className="mt-5 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted transition hover:border-brand hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand/15 px-4 py-2 text-sm">
                {m.text}
              </div>
            ) : (
              <div className="max-w-[92%]">
                <AnswerText text={m.text} streaming={m.streaming} />
                {m.citations && m.citations.length > 0 && (
                  <CitationsBlock citations={m.citations} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-border p-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasDocs ? "Ask a question…" : "Upload a document first"}
          disabled={busy || !hasDocs}
          className="flex-1 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-brand disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !hasDocs || !input.trim()}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-fg transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

// Render answer text, turning [n] markers into highlighted citation badges.
function AnswerText({ text, streaming }: { text: string; streaming?: boolean }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((p, i) =>
        /^\[\d+\]$/.test(p) ? (
          <sup
            key={i}
            className="mx-0.5 rounded bg-brand/20 px-1 text-[10px] font-semibold text-brand"
          >
            {p.replace(/[[\]]/g, "")}
          </sup>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      {streaming && <span className="ml-0.5 animate-pulse">▋</span>}
    </div>
  );
}

function CitationsBlock({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        Sources
      </p>
      {citations.map((c) => (
        <div
          key={c.n}
          className="rounded-lg border border-border bg-surface-2 p-3 text-xs"
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-brand/20 px-1.5 py-0.5 font-semibold text-brand">
              {c.n}
            </span>
            <span className="font-medium">{c.documentTitle}</span>
            {c.page != null && <span className="text-muted">· p.{c.page}</span>}
            <span className="ml-auto text-muted">
              {(c.score * 100).toFixed(0)}% match
            </span>
          </div>
          <p className="text-muted">{c.snippet}</p>
        </div>
      ))}
    </div>
  );
}
