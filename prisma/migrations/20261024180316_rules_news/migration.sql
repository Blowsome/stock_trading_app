-- AlterTable
ALTER TABLE "SimPath" ADD COLUMN "strategy" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Simulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "status" TEXT NOT NULL,
    "universe" JSONB,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" DATETIME,
    CONSTRAINT "Simulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Simulation" ("createdAt", "endDate", "error", "id", "revealedAt", "startDate", "status", "universe", "userId") SELECT "createdAt", "endDate", "error", "id", "revealedAt", "startDate", "status", "universe", "userId" FROM "Simulation";
DROP TABLE "Simulation";
ALTER TABLE "new_Simulation" RENAME TO "Simulation";
CREATE INDEX "Simulation_userId_createdAt_idx" ON "Simulation"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
