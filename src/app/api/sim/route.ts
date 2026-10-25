import { getCurrentSim } from "@/server/auth";
import { json, withUser } from "@/server/http";
import { simState } from "@/server/simulation";

export const dynamic = "force-dynamic";

/** The current simulation's progress, or null in live mode. */
export const GET = withUser(async (user) => {
  const sim = await getCurrentSim();
  return json({ sim: sim ? await simState(user.id, sim.id) : null });
});
