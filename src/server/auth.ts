import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

export const SESSION_COOKIE = "mt_session";
const SESSION_DAYS = 30;

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

/** The simulation this login is in, or null in live mode. */
export async function getCurrentSim() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const session = await prisma.session.findUnique({ where: { id }, include: { simulation: true } });
  if (!session || session.expiresAt < new Date() || session.simulation?.userId !== session.userId) return null;
  return session.simulation;
}

/** Switches this login between live trading (null) and a simulation. */
export async function setSessionSimulation(simulationId: string | null) {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (id) await prisma.session.update({ where: { id }, data: { simulationId } });
}
