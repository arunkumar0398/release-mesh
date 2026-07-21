import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Shell static assets", () => {
  it("declares a favicon that exists", async () => {
    const packageRoot = process.cwd().endsWith("shell")
      ? process.cwd()
      : resolve(process.cwd(), "apps/shell");
    const html = await readFile(resolve(packageRoot, "index.html"), "utf8");

    expect(html).toContain('<link rel="icon" href="/favicon.svg" />');
    await expect(access(resolve(packageRoot, "public/favicon.svg"))).resolves.toBeUndefined();
  });
});
