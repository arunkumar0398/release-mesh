import { PrismaClient } from "./generated/prisma/client.js";

export { PrismaClient };

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
