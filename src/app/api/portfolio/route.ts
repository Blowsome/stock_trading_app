import { getCurrentSim } from "@/server/auth";
import { json, withUser } from "@/server/http";
import { getPortfolio } from "@/server/portfolio";
import { simPortfolio } from "@/server/simulation";

export const GET = withUser(async (user) => {
  const sim = await getCurrentSim();
  return json(sim ? await simPortfolio(user.id, sim.id) : await getPortfolio(user.id));
});
