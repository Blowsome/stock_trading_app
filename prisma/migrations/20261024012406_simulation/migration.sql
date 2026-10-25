-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "universe" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" DATETIME,
    CONSTRAINT "Simulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimPath" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "simulationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runIndex" INTEGER NOT NULL,
    "cash" DECIMAL NOT NULL,
    "reasoning" TEXT,
    "error" TEXT,
    "decidedAt" DATETIME,
    "finalValue" DECIMAL,
    CONSTRAINT "SimPath_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimHolding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pathId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "shares" DECIMAL NOT NULL,
    "avgCost" DECIMAL NOT NULL,
    "exitPrice" DECIMAL,
    CONSTRAINT "SimHolding_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "SimPath" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pathId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "shares" DECIMAL NOT NULL,
    "price" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SimTrade_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "SimPath" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "simulationId" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("expiresAt", "id", "userId") SELECT "expiresAt", "id", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "cash" DECIMAL NOT NULL DEFAULT 1000000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("cash", "createdAt", "email", "id", "name", "passwordHash") SELECT "cash", "createdAt", "email", "id", "name", "passwordHash" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Simulation_userId_createdAt_idx" ON "Simulation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimPath_simulationId_kind_runIndex_key" ON "SimPath"("simulationId", "kind", "runIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SimHolding_pathId_symbol_key" ON "SimHolding"("pathId", "symbol");
