import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { retrieve } from "@/lib/retrieve";
import {
  ANSWER_DELIMITER,
  ANSWER_MODEL,
  GEMINI_MODELS,
  SYSTEM_PROMPT,
  extractiveAnswer,
  toCitations,
  userPrompt,
} from "@/lib/answer";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/ask — retrieve relevant chunks, then stream an answer.
// Wire format: `<citations JSON>` + ANSWER_DELIMITER + `<answer text stream>`.
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const question: string = body?.question?.trim();
  const documentId: string | undefined = body?.documentId || undefined;
  if (!question) return new Response("Question is required", { status: 400 });

  const chunks = await retrieve(userId, question, { documentId, topK: 5 });
  const citations = toCitations(chunks);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 1) Send citations header up front so the UI can render sources
      //    immediately, before the answer text arrives.
      controller.enqueue(encoder.encode(JSON.stringify({ citations })));
      controller.enqueue(encoder.encode(ANSWER_DELIMITER));

      let answer = "";
      let model = "extractive";

      try {
        if (anthropicKey && chunks.length > 0) {
          model = ANSWER_MODEL;
          const client = new Anthropic({ apiKey: anthropicKey });
          const mstream = client.messages.stream({
            model: ANSWER_MODEL,
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userPrompt(question, chunks) }],
          });

          for await (const event of mstream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              answer += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } else if (geminiKey && chunks.length > 0) {
          // Gemini free-tier path. Streams Server-Sent Events; each `data:` line
          // carries a JSON chunk with candidates[0].content.parts[].text.
          // Free-tier daily quotas are per model, so on quota/availability
          // errors (429/404/503) the same request is retried on the next
          // model in GEMINI_MODELS before giving up.
          let res: Response | null = null;
          let lastError = "";
          for (const candidate of GEMINI_MODELS) {
            const attempt = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:streamGenerateContent?alt=sse`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                  contents: [{ role: "user", parts: [{ text: userPrompt(question, chunks) }] }],
                  generationConfig: { maxOutputTokens: 4096 },
                }),
              },
            );
            if (attempt.ok && attempt.body) {
              res = attempt;
              model = candidate;
              break;
            }
            lastError = `Gemini ${attempt.status} (${candidate}): ${await attempt.text().catch(() => "")}`;
            if (![429, 404, 503].includes(attempt.status)) break;
          }
          if (!res || !res.body) {
            throw new Error(lastError || "Gemini: no model available");
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? ""; // keep the last, possibly-partial line
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const parts = json?.candidates?.[0]?.content?.parts ?? [];
                const delta = parts
                  .filter((p: { thought?: boolean }) => !p.thought)
                  .map((p: { text?: string }) => p.text ?? "")
                  .join("");
                if (delta) {
                  answer += delta;
                  controller.enqueue(encoder.encode(delta));
                }
              } catch {
                // Ignore partial/non-JSON keep-alive lines.
              }
            }
          }
        } else {
          // Extractive fallback (no API key or nothing retrieved).
          answer = extractiveAnswer(chunks);
          controller.enqueue(encoder.encode(answer));
        }
      } catch (err) {
        const msg =
          "\n\n_(The AI service errored, so here are the raw passages instead.)_\n\n" +
          extractiveAnswer(chunks, "**Most relevant passages I retrieved:**");
        answer += msg;
        controller.enqueue(encoder.encode(msg));
        console.error("ask stream error:", err);
      }

      // 2) Persist the Q&A for history.
      try {
        await prisma.query.create({
          data: {
            userId,
            documentId: documentId ?? null,
            question,
            answer,
            citations: citations as unknown as object,
            model,
          },
        });
      } catch (e) {
        console.error("failed to persist query:", e);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
