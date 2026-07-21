import type { Server } from "node:http";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

import { createPricingServer } from "../../fixtures/pricing/src/server.js";

let pricingServer: Server | undefined;
let checkoutServer: ViteDevServer | undefined;
let checkoutUrl: string;

async function startPricing(mode: "v2" | "v2.1"): Promise<void> {
  pricingServer = createPricingServer({ mode });
  await new Promise<void>((done) => pricingServer?.listen(0, "127.0.0.1", done));
  const address = pricingServer.address();
  if (!address || typeof address === "string") throw new Error("Pricing fixture did not bind");
  checkoutServer = await createServer({
    define: { "import.meta.env.VITE_PRICING_BASE_URL": JSON.stringify("") },
    root: resolve("fixtures/checkout"),
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: { "/pricing": { target: `http://127.0.0.1:${address.port}` } }
    }
  });
  await checkoutServer.listen();
  checkoutUrl = checkoutServer.resolvedUrls?.local[0] ?? "";
  if (!checkoutUrl) throw new Error("Checkout fixture did not bind");
}

test.afterEach(async () => {
  await checkoutServer?.close();
  checkoutServer = undefined;
  if (pricingServer) {
    const server = pricingServer;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    pricingServer = undefined;
  }
});

test("Pricing v2 captures the broken Checkout experience", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await startPricing("v2");

  await page.goto(checkoutUrl);

  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute("href", /.+/);
  await expect(page.getByRole("alert")).toContainText("Checkout unavailable");
  await expect(page.getByRole("alert")).toContainText(
    "Pricing response is incompatible: missing price, currency"
  );
  const screenshotPath = testInfo.outputPath("checkout-v2-blocked.png");
  await page.screenshot({ fullPage: true, path: screenshotPath });
  expect((await stat(screenshotPath)).size).toBeGreaterThan(0);
  await testInfo.attach("checkout-v2-blocked", {
    path: screenshotPath,
    contentType: "image/png"
  });
  expect(consoleErrors).toEqual([]);
});

test("Pricing v2.1 keeps Checkout working", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await startPricing("v2.1");

  await page.goto(checkoutUrl);

  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute("href", /.+/);
  await expect(page.getByText("Pricing available")).toBeVisible();
  await expect(page.getByText("INR 1299")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
