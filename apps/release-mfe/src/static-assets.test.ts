import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Release MFE static assets", () => {
  it("declares a standalone favicon that exists", async () => {
    const packageRoot = process.cwd().endsWith("release-mfe")
      ? process.cwd()
      : resolve(process.cwd(), "apps/release-mfe");
    const html = await readFile(resolve(packageRoot, "index.html"), "utf8");

    expect(html).toContain('<link rel="icon" href="/favicon.svg" />');
    await expect(access(resolve(packageRoot, "public/favicon.svg"))).resolves.toBeUndefined();
  });
});
