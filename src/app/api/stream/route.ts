import { getCurrentUser } from "@/server/auth";
import { priceHub, type Tick } from "@/server/priceHub";
import { normalizeSymbol } from "@/server/symbols";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 30;

/** Server-sent events: `data: [{symbol, price, time}, ...]` whenever trades arrive. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Not signed in", { status: 401 });
  const raw = (new URL(req.url).searchParams.get("symbols") ?? "").split(",");
  const symbols = [...new Set(raw.map(normalizeSymbol).filter((s): s is string => !!s))].slice(0, MAX_SYMBOLS);

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (ticks: Tick[]) => {
        if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(ticks)}\n\n`));
      };
      const unsubscribe = priceHub.subscribe(symbols, send);
      const heartbeat = setInterval(() => open && controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", cleanup);

      // Start everyone off with the latest known price.
      const initial = await Promise.all(
        symbols.map(async (symbol) => {
          const price = await priceHub.getPrice(symbol).catch(() => null);
          return price ? { symbol, price, time: priceHub.peek(symbol)?.time ?? Date.now() } : null;
        }),
      );
      send(initial.filter((t): t is Tick => !!t));
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
