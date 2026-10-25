"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Result = { symbol: string; description: string; type: string };

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(term)}`);
        setResults(r.results);
        setActive(0);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function go(symbol: string) {
    setQ("");
    setOpen(false);
    router.push(`/stocks/${encodeURIComponent(symbol)}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Enter") {
      const pick = results[active]?.symbol ?? q.trim().toUpperCase();
      if (pick) go(pick);
    } else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={box} className="relative w-full max-w-md">
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search stocks or Bitcoin"
        aria-label="Search stocks or Bitcoin"
        className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-muted"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-line bg-elevated shadow-xl">
          {results.map((r, i) => (
            <li key={r.symbol}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.symbol)}
                className={`flex w-full items-center gap-4 px-4 py-2.5 text-left text-sm ${i === active ? "bg-line" : ""}`}
              >
                <span className="w-16 shrink-0 font-semibold">{r.symbol}</span>
                <span className="truncate text-muted">{r.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
