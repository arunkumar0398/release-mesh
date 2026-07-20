import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (!existsSync(resolve("src/generated/prisma/client.js"))) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "generate", "--schema", "prisma/schema.prisma"],
    { stdio: "inherit" }
  );

  process.exit(result.status ?? 1);
}
