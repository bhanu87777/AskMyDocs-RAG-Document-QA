import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// POST /api/register — create a new account.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 },
    );
  }
  if (String(body.password).length < 6) {
    return NextResponse.json(
      { error: "password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: String(body.email) },
  });
  if (existing) {
    return NextResponse.json(
      { error: "an account with that email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(String(body.password), 10);
  const user = await prisma.user.create({
    data: {
      email: String(body.email),
      name: body.name ? String(body.name) : null,
      password: passwordHash,
    },
  });
  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
