import { z } from "zod";
import { prisma } from "@/server/db";
import { createSession, hashPassword } from "@/server/auth";
import { fail, json } from "@/server/http";
import { STARTING_CASH } from "@/server/trading";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { name, email, password } = parsed.data;
  if (await prisma.user.findUnique({ where: { email } })) return fail("An account with that email already exists");
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      cash: STARTING_CASH,
      snapshots: { create: { totalValue: STARTING_CASH } },
    },
  });
  await createSession(user.id);
  return json({ ok: true });
}
