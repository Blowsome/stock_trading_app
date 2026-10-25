import { getMarketStatus } from "@/server/finnhub";
import { json, withUser } from "@/server/http";

export const GET = withUser(async () => json(await getMarketStatus()));
