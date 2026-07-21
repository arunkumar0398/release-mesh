import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Catalog MFE static assets", () => {
  it("declares a standalone favicon that exists", async () => {
    const packageRoot = process.cwd().endsWith("catalog-mfe")
      ? process.cwd()
      : resolve(process.cwd(), "apps/catalog-mfe");
    const html = await readFile(resolve(packageRoot, "index.html"), "utf8");

    expect(html).toContain('<link rel="icon" href="/favicon.svg" />');
    await expect(access(resolve(packageRoot, "public/favicon.svg"))).resolves.toBeUndefined();
  });
});
