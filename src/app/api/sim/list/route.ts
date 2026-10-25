import { json, withUser } from "@/server/http";
import { listSimulations } from "@/server/simulation";

export const GET = withUser(async (user) => json({ simulations: await listSimulations(user.id) }));
