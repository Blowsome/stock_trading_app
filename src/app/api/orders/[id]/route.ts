import { json, withUser } from "@/server/http";
import { cancelOrder } from "@/server/trading";

export const DELETE = withUser(async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
  await cancelOrder(user.id, (await ctx.params).id);
  return json({ ok: true });
});
