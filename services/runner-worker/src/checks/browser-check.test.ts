import { describe, expect, it, vi } from "vitest";

import { createCheckoutBrowserCheck } from "./browser-check.js";

function createBrowserFixture(hasAlert: boolean, hasReady = !hasAlert) {
  const page = {
    getByText: vi.fn(() => ({ count: vi.fn().mockResolvedValue(hasReady ? 1 : 0) })),
    getByRole: vi.fn((role: string) => ({
      count: vi.fn().mockResolvedValue(role === "alert" && hasAlert ? 1 : 0),
      waitFor: vi.fn().mockResolvedValue(undefined)
    })),
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from([137, 80, 78, 71]))
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page)
  };
  return {
    browser,
    launch: vi.fn().mockResolvedValue(browser),
    page
  };
}

describe("createCheckoutBrowserCheck", () => {
  it.each([
    [false, true],
    [true, false]
  ])("captures bounded screenshot evidence when alert=%s", async (hasAlert, passed) => {
    const fixture = createBrowserFixture(hasAlert);
    const runCheck = createCheckoutBrowserCheck({
      browserLauncher: { launch: fixture.launch },
      checkoutBaseUrl: "http://checkout.test",
      trustedCheckoutOrigins: ["http://checkout.test"]
    });

    await expect(runCheck()).resolves.toEqual({
      passed,
      screenshot: new Uint8Array([137, 80, 78, 71]),
      testId: "browser-checkout"
    });
    expect(fixture.page.goto).toHaveBeenCalledWith("http://checkout.test/", {
      waitUntil: "networkidle"
    });
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it.each([
    "http://169.254.169.254",
    "http://user:password@checkout.test",
    "http://checkout.test/internal",
    "file:///workspace/repository"
  ])("rejects untrusted Checkout URL %s", (checkoutBaseUrl) => {
    expect(() =>
      createCheckoutBrowserCheck({
        browserLauncher: { launch: vi.fn() },
        checkoutBaseUrl,
        trustedCheckoutOrigins: ["http://checkout.test"]
      })
    ).toThrow("Untrusted Checkout URL");
  });

  it("closes Playwright when navigation crashes", async () => {
    const fixture = createBrowserFixture(false);
    fixture.page.goto.mockRejectedValue(new Error("browser crashed"));
    const runCheck = createCheckoutBrowserCheck({
      browserLauncher: { launch: fixture.launch },
      checkoutBaseUrl: "http://checkout.test",
      trustedCheckoutOrigins: ["http://checkout.test"]
    });

    await expect(runCheck()).rejects.toThrow("browser crashed");
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it("rejects a page with neither explicit success nor failure semantics", async () => {
    const fixture = createBrowserFixture(false, false);
    const runCheck = createCheckoutBrowserCheck({
      browserLauncher: { launch: fixture.launch },
      checkoutBaseUrl: "http://checkout.test",
      trustedCheckoutOrigins: ["http://checkout.test"]
    });

    await expect(runCheck()).rejects.toThrow("Checkout outcome was not rendered");
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });
});
