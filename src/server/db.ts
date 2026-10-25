import { PrismaClient, Prisma } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma = g.__prisma ?? new PrismaClient();
g.__prisma = prisma;

export const D = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type Tx = Prisma.TransactionClient;
