import { simWindows } from "@/server/asOf";
import { json, withUser } from "@/server/http";

/** The periods a simulation can cover, newest first. */
export const GET = withUser(async () => json({ windows: await simWindows() }));
