"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useSim } from "@/lib/simContext";
import { Logo } from "./Logo";
import { MarketBadge } from "./MarketBadge";
import { SearchBox } from "./SearchBox";

export function Header({ name }: { name: string }) {
  const path = usePathname();
  const router = useRouter();
  const sim = useSim();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const nav = (href: string, label: string) => (
    <Link href={href} className={`text-sm hover:text-fg ${path === href ? "text-fg" : "text-muted"}`}>
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" aria-label="Home">
          <Logo hideTextOnMobile />
        </Link>
        <SearchBox />
        <nav className="ml-auto flex items-center gap-5">
          {!sim && <MarketBadge />}
          {nav("/", "Investing")}
          <div ref={ref} className="relative">
            <button onClick={() => setMenu((m) => !m)} className={`text-sm hover:text-fg ${path === "/account" ? "text-fg" : "text-muted"}`}>
              Account
            </button>
            {menu && (
              <div className="absolute right-0 mt-3 w-52 overflow-hidden rounded-md border border-line bg-elevated text-sm shadow-xl">
                <div className="border-b border-line px-4 py-3 font-semibold">{name}</div>
                <Link href="/account" onClick={() => setMenu(false)} className="block px-4 py-2.5 hover:bg-line">
                  Account & history
                </Link>
                <Link href="/start" onClick={() => setMenu(false)} className="block px-4 py-2.5 hover:bg-line">
                  {sim ? "Switch mode or period" : "Start a simulation"}
                </Link>
                <Link href="/simulations" onClick={() => setMenu(false)} className="block px-4 py-2.5 hover:bg-line">
                  Simulation results
                </Link>
                <button onClick={logout} className="block w-full px-4 py-2.5 text-left hover:bg-line">
                  Log out
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
