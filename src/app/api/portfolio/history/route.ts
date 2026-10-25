import { json, withUser } from "@/server/http";
import { portfolioHistory } from "@/server/portfolio";

export const GET = withUser(async (user, req) => {
  const range = new URL(req.url).searchParams.get("range") ?? "1D";
  return json({ points: await portfolioHistory(user.id, range) });
});
