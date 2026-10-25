import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // A separate build folder (e.g. NEXT_DIST_DIR=.next-check) lets a production build run
  // without overwriting the files of a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
