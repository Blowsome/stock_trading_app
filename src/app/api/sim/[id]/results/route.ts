import { json, withUser } from "@/server/http";
import { simResults } from "@/server/simulation";

export const GET = withUser(async (user, _req, { params }: { params: Promise<{ id: string }> }) =>
  json(await simResults(user.id, (await params).id)),
);
