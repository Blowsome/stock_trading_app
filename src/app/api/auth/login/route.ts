import { prisma } from "@/server/db";
import { createSession, verifyPassword } from "@/server/auth";
import { fail, json } from "@/server/http";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return fail("Incorrect email or password", 401);
  await createSession(user.id);
  return json({ ok: true });
}
