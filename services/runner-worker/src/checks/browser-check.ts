import { chromium } from "playwright";
import type { PricingContractVersion } from "@releasemesh/contracts";

interface BrowserPage {
  getByRole(role: "alert"): { count(): Promise<number> };
  getByText(text: "Pricing available"): { count(): Promise<number> };
  goto(url: string, options: { waitUntil: "networkidle" }): Promise<unknown>;
  screenshot(options: { fullPage: true; type: "png" }): Promise<Buffer>;
  url(): string;
}

interface BrowserInstance {
  close(): Promise<void>;
  newPage(): Promise<BrowserPage>;
}

export interface BrowserLauncher {
  launch(options?: { headless: boolean }): Promise<BrowserInstance>;
}

export interface CheckoutBrowserCheckResult {
  passed: boolean;
  screenshot: Uint8Array;
  testId: "browser-checkout";
}

export function createCheckoutBrowserCheck({
  browserLauncher = chromium as unknown as BrowserLauncher,
  checkoutBaseUrl,
  trustedCheckoutOrigins
}: {
  browserLauncher?: BrowserLauncher;
  checkoutBaseUrl: string;
  trustedCheckoutOrigins: readonly string[];
}): (candidateVersion: PricingContractVersion) => Promise<CheckoutBrowserCheckResult> {
  const checkoutUrl = resolveTrustedCheckoutUrl(checkoutBaseUrl, trustedCheckoutOrigins);

  return async (candidateVersion) => {
    const browser = await browserLauncher.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const candidateUrl = new URL(checkoutUrl);
      candidateUrl.searchParams.set("candidateVersion", candidateVersion);
      await page.goto(candidateUrl.toString(), { waitUntil: "networkidle" });
      let finalOrigin: string;
      try {
        finalOrigin = new URL(page.url()).origin;
      } catch {
        throw new Error("Checkout navigation reached an untrusted origin");
      }
      if (finalOrigin !== candidateUrl.origin) {
        throw new Error("Checkout navigation reached an untrusted origin");
      }
      const hasAlert = (await page.getByRole("alert").count()) > 0;
      const hasReadyState = (await page.getByText("Pricing available").count()) > 0;
      if (hasAlert === hasReadyState) {
        throw new Error("Checkout outcome was not rendered unambiguously");
      }
      const screenshot = await page.screenshot({ fullPage: true, type: "png" });
      return {
        passed: !hasAlert,
        screenshot: Uint8Array.from(screenshot),
        testId: "browser-checkout"
      };
    } finally {
      await browser.close();
    }
  };
}

function resolveTrustedCheckoutUrl(
  checkoutBaseUrl: string,
  trustedCheckoutOrigins: readonly string[]
): string {
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(checkoutBaseUrl);
  } catch {
    throw new Error("Untrusted Checkout URL");
  }

  const trustedOrigins = trustedCheckoutOrigins.map(normalizeTrustedOrigin);
  if (
    (checkoutUrl.protocol !== "http:" && checkoutUrl.protocol !== "https:") ||
    checkoutUrl.username !== "" ||
    checkoutUrl.password !== "" ||
    checkoutUrl.pathname !== "/" ||
    checkoutUrl.search !== "" ||
    checkoutUrl.hash !== "" ||
    !trustedOrigins.includes(checkoutUrl.origin)
  ) {
    throw new Error("Untrusted Checkout URL");
  }

  return `${checkoutUrl.origin}/`;
}

function normalizeTrustedOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Untrusted Checkout URL");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Untrusted Checkout URL");
  }
  return url.origin;
}
