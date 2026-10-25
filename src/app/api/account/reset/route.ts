import { json, withUser } from "@/server/http";
import { resetAccount } from "@/server/trading";

export const POST = withUser(async (user) => {
  await resetAccount(user.id);
  return json({ ok: true });
});
