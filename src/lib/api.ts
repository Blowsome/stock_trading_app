"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth")) window.location.href = "/login";
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const reloaders = new Map<string, Set<() => void>>();

/** Re-fetches every mounted useFetch whose URL starts with one of the prefixes. */
export function revalidate(...prefixes: string[]) {
  for (const [url, set] of reloaders) {
    if (prefixes.some((p) => url.startsWith(p))) set.forEach((fn) => fn());
  }
}

export function useFetch<T>(url: string | null, opts?: { refreshMs?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const current = useRef(url);
  current.current = url;

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const d = await api<T>(url);
      if (current.current === url) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (current.current === url) setError((e as Error).message);
    } finally {
      if (current.current === url) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    load();
    let set = reloaders.get(url);
    if (!set) reloaders.set(url, (set = new Set()));
    set.add(load);
    const timer = opts?.refreshMs ? setInterval(load, opts.refreshMs) : null;
    return () => {
      set!.delete(load);
      if (set!.size === 0) reloaders.delete(url);
      if (timer) clearInterval(timer);
    };
  }, [url, load, opts?.refreshMs]);

  return { data, error, loading, reload: load };
}
