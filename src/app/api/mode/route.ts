import { setSessionSimulation } from "@/server/auth";
import { fail, json, withUser } from "@/server/http";
import { getOrCreateSimulation } from "@/server/simulation";

export const POST = withUser(async (user, req) => {
  const body = await req.json().catch(() => ({}));
  if (body.mode === "live") {
    await setSessionSimulation(null);
    return json({ ok: true });
  }
  if (body.mode !== "sim") return fail("Mode must be live or sim");
  const sim = await getOrCreateSimulation(user.id, Number(body.window ?? 0) || 0);
  await setSessionSimulation(sim.id);
  return json({ ok: true, id: sim.id });
});
