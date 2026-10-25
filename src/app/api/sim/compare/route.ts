import { json, withUser } from "@/server/http";
import { compareSimulations } from "@/server/simulation";

export const GET = withUser(async (user) => json(await compareSimulations(user.id)));
