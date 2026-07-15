// TEMPORARY deploy-debug route — DELETE after verifying the deployment.
// Pings the DB and reports which env vars exist (never their values) + timing.
// Instant failure (~70ms) = network/IPv6/refused; slow (~5-15s) = timeout;
// 28P01 in the error = wrong credentials.
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    region: process.env.VERCEL_REGION ?? null,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasDirectUrl: !!process.env.DIRECT_URL,
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    nextauthUrl: process.env.NEXTAUTH_URL ?? null,
    dbHost: (process.env.DATABASE_URL ?? "").split("@")[1]?.split("/")[0] ?? null,
  };
  try {
    const t = Date.now();
    const r = await prisma.$queryRaw`SELECT 1 as ok`;
    return Response.json({ ok: true, ms: Date.now() - t, db: r, env });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e).slice(0, 300), env },
      { status: 500 },
    );
  }
}
