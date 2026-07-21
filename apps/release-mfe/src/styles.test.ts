import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Release MFE styles", () => {
  it("does not expose document-wide selectors to the Shell", async () => {
    const packageRoot = process.cwd().endsWith("release-mfe")
      ? process.cwd()
      : resolve(process.cwd(), "apps/release-mfe");
    const css = await readFile(resolve(packageRoot, "src/styles.css"), "utf8");

    expect(css).not.toMatch(/(^|\n):root\s*\{/);
    expect(css).not.toMatch(/(^|\n)body\s*\{/);
    expect(css).not.toMatch(/(^|\n)button\s*\{/);
    expect(css).not.toMatch(/(^|\n)(h1|h2|h3|p|ol|ul|pre|img)(,|\s*\{)/);
  });
});
