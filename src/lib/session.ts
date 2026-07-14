import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export function getSession() {
  return getServerSession(authOptions);
}

// Convenience: return the signed-in user's id, or null.
export async function getUserId(): Promise<string | null> {
  const session = await getSession();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}
