# 🏗️ AskMyDocs — Architecture

How a document becomes a grounded, cited answer — from upload to streamed token.

---

## 1. The big picture

AskMyDocs is a single **Next.js 16 (App Router)** application. Server-side route
handlers own the RAG pipeline; the client is a streaming chat UI. Everything —
documents, chunks, embedding vectors — lives in **PostgreSQL** via **Prisma**.

```
┌──────────────────────────────┐         ┌────────────────────────────────────┐
│  Client (React 19)           │         │  Next.js route handlers (server)     │
│  • DocumentLibrary           │  upload │  /api/documents  → ingest pipeline   │
│  • ChatPanel (streaming)     │ ──────▶ │  /api/ask        → retrieve + answer │
│  • Workspace / Navbar        │  ask    │  /api/register · /api/auth/[…]       │
└──────────────────────────────┘         └───────────────┬──────────────────────┘
                                                          │ Prisma
                        ┌─────────────────────────────────┼───────────────────┐
                        ▼                                  ▼                   ▼
              transformers.js                     PostgreSQL              Claude / Gemini
              all-MiniLM-L6-v2                   (Document, Chunk           (grounded
              (local, 384-dim)                    w/ JSON vectors)          generation)
```

Two AI stages, deliberately split: **embeddings run locally** (free, offline, no
document text leaves the box) and **generation runs remotely** (Claude or Gemini),
with a fully-offline extractive fallback if no key is set.

---

## 2. Ingestion pipeline (`src/lib/ingest.ts`)

```
Upload (PDF / TXT / MD)
   │
   ├─ 1. Parse   (src/lib/parse.ts)     PDFs read page-by-page (pdf-parse v2) so
   │                                    a citation can point at a real page.
   ├─ 2. Chunk   (src/lib/chunk.ts)     Split along structure (headings, paragraphs)
   │                                    into ~450-char, topically-coherent chunks.
   ├─ 3. Embed   (src/lib/embeddings.ts) Each chunk → 384-dim vector, locally, with
   │                                    Xenova/all-MiniLM-L6-v2 (transformers.js).
   └─ 4. Store                          Chunk rows (content + page + JSON vector)
                                        persisted; Document status → READY.
```

> **Why structure-aware chunking?** Fixed-size windows straddle topic boundaries
> and wreck retrieval precision. Splitting along the document's own structure keeps
> each chunk about *one* thing — which is what makes the top-5 retrieval accurate.

---

## 3. Query pipeline (`src/lib/retrieve.ts` → `src/app/api/ask/route.ts`)

```
Question
   │
   ├─ 1. Embed the question locally (same model as ingestion).
   ├─ 2. Score every candidate chunk by COSINE SIMILARITY (src/lib/similarity.ts);
   │      take the top 5. Scope = all documents or one selected document.
   ├─ 3. Build a numbered-source prompt; ask Claude/Gemini to answer GROUNDED in
   │      those sources, citing [n]  (src/lib/answer.ts).
   └─ 4. Stream the response:  citations JSON  +  ANSWER_DELIMITER  +  answer text
          → the UI renders the SOURCES panel immediately, then streams the answer.
```

**No API key?** Step 3 falls back to returning the retrieved passages verbatim, so
retrieval is demonstrable end-to-end for free.

> At this scale, in-memory cosine ranking is simple and fully explainable. To
> scale up you'd push vectors into an ANN index or PostgreSQL's `pgvector` type.

---

## 4. Data model (`prisma/schema.prisma`)

| Model | Purpose |
|-------|---------|
| `User` | Account (email + bcrypt password hash). |
| `Document` | An uploaded file: title, filename, mimeType, `status` (PROCESSING / READY / FAILED), page & chunk counts. |
| `Chunk` | One passage: `content`, source `page`, and its `embedding` (JSON `number[]`) + order `idx`. |
| `Query` | A logged question + answer + `citations` JSON `[{ documentId, title, page, snippet, score }]` + which model answered. |

`Chunk.embedding` is stored as JSON so the app has **zero infra dependencies**
beyond a stock PostgreSQL — the vector search is plain application code.

---

## 5. Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── ask/route.ts               # retrieve + grounded, streamed answer
│   │   ├── documents/route.ts         # upload → ingest; list
│   │   ├── documents/[id]/route.ts    # fetch / delete a document
│   │   ├── register/route.ts          # sign-up
│   │   └── auth/[...nextauth]/route.ts # next-auth (credentials, JWT)
│   ├── chat/page.tsx                  # the workspace
│   ├── login/page.tsx                 # auth screen
│   ├── page.tsx                       # landing (redirects to /chat if signed in)
│   └── layout.tsx
├── components/                        # Workspace, ChatPanel, DocumentLibrary, Navbar, Providers
└── lib/
    ├── ingest.ts                      # orchestrates parse → chunk → embed → store
    ├── parse.ts · chunk.ts            # per-page parsing + structure-aware chunking
    ├── embeddings.ts · similarity.ts  # local model + cosine ranking
    ├── retrieve.ts · answer.ts        # top-5 retrieval + grounded generation
    ├── auth.ts · session.ts           # next-auth config + helpers
    └── prisma.ts · constants.ts       # DB client + shared ANSWER_DELIMITER
```

---

## 6. Auth

Email/password via **next-auth** (credentials provider, JWT sessions). Passwords
are bcrypt-hashed. Every document and query is scoped to the signed-in `User`, so
one account can never read another's files or history.
