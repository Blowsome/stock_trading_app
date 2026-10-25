import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const db = path.resolve(__dirname, "../../prisma/test.db");

export function setup() {
  rmSync(db, { force: true });
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });
}

export function teardown() {
  rmSync(db, { force: true });
  rmSync(`${db}-journal`, { force: true });
}
