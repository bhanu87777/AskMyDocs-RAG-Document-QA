"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

export function Navbar() {
  const { data: session } = useSession();
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/chat" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand">📄</span>
          <span>
            Ask<span className="text-brand">MyDocs</span>
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {session?.user?.email && (
            <span className="hidden text-muted sm:inline">{session.user.email}</span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md border border-border px-3 py-1.5 text-muted transition hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
