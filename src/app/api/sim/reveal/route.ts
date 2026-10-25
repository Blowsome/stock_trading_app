import { getCurrentSim } from "@/server/auth";
import { fail, json, withUser } from "@/server/http";
import { revealSimulation } from "@/server/simulation";

export const POST = withUser(async (user) => {
  const sim = await getCurrentSim();
  if (!sim) return fail("Not in a simulation");
  await revealSimulation(user.id, sim.id);
  return json({ ok: true, id: sim.id });
});
