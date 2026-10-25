import { getCurrentSim } from "@/server/auth";
import { fail, json, withUser } from "@/server/http";
import { simUniverse } from "@/server/simulation";

export const GET = withUser(async (user) => {
  const sim = await getCurrentSim();
  if (!sim) return fail("Not in a simulation");
  return json({ universe: await simUniverse(user.id, sim.id) });
});
