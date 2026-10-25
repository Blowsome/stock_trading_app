"use client";

import { createContext, useContext } from "react";
import type { SimInfo } from "./sim";
import { setLiveEnabled } from "./livePrices";

const SimContext = createContext<SimInfo | null>(null);

/** Tells the app whether this login is in a simulation. Set before children subscribe to live prices. */
export function SimProvider({ sim, children }: { sim: SimInfo | null; children: React.ReactNode }) {
  setLiveEnabled(!sim);
  return <SimContext.Provider value={sim}>{children}</SimContext.Provider>;
}

/** The current simulation, or null in live mode. */
export const useSim = () => useContext(SimContext);
