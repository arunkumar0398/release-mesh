import type { Server } from "node:http";

import { expect, test } from "@playwright/test";

import { createPricingServer } from "../../fixtures/pricing/src/server.js";

let pricingServer: Server | undefined;

async function startPricing(mode: "v2" | "v2.1"): Promise<void> {
  pricingServer = createPricingServer({ mode });
  await new Promise<void>((resolve) => pricingServer?.listen(4100, "127.0.0.1", resolve));
}

test.afterEach(async () => {
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
  await startPricing("v2");

  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText("Checkout unavailable");
  await expect(page.getByRole("alert")).toContainText(
    "Pricing response is incompatible: missing price, currency"
  );
  await testInfo.attach("checkout-v2-blocked", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
});

test("Pricing v2.1 keeps Checkout working", async ({ page }) => {
  await startPricing("v2.1");

  await page.goto("/");

  await expect(page.getByText("Pricing available")).toBeVisible();
  await expect(page.getByText("INR 1299")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
