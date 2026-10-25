import { getCurrentSim } from "@/server/auth";
import { fail, json, withUser } from "@/server/http";
import { retrySimulation } from "@/server/simulation";

export const POST = withUser(async (user) => {
  const sim = await getCurrentSim();
  if (!sim) return fail("Not in a simulation");
  await retrySimulation(user.id, sim.id);
  return json({ ok: true });
});
