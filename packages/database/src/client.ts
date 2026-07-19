import { PrismaClient } from "./generated/prisma/client.js";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
