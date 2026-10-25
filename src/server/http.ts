import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { getCurrentUser } from "./auth";
import { TradeError } from "./trading";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Wraps a route handler with auth and uniform error responses. */
export function withUser<A extends unknown[]>(handler: (user: User, req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A) => {
    const user = await getCurrentUser();
    if (!user) return fail("Not signed in", 401);
    try {
      return await handler(user, req, ...rest);
    } catch (e) {
      if (e instanceof TradeError) return fail(e.message, 400);
      console.error(e);
      return fail(e instanceof Error ? e.message : "Something went wrong", 500);
    }
  };
}
