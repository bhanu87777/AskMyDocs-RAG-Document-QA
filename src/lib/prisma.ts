import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// On Vercel's serverless functions there is no IPv6 egress, but Neon hosts are
// dual-stack — Prisma's TCP engine can pick the IPv6 address and the socket
// dies instantly ("Can't reach database server"). Connecting through Neon's
// serverless driver over WebSocket avoids raw TCP and sidesteps the issue.
// Kept conditional so local development against a normal Postgres still works.
function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  const log: ("error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (url.includes("neon.tech")) {
    neonConfig.webSocketConstructor = ws;
    const clean = new URL(url);
    // Some Prisma engine builds cannot negotiate channel binding.
    clean.searchParams.delete("channel_binding");
    const adapter = new PrismaNeon({ connectionString: clean.toString() });
    return new PrismaClient({ adapter, log });
  }

  return new PrismaClient({ log }); // local Postgres: plain TCP
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
