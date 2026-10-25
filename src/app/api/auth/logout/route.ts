import { destroySession } from "@/server/auth";
import { json } from "@/server/http";

export async function POST() {
  await destroySession();
  return json({ ok: true });
}
