import type { PricingApiCheckResult } from "./checks/api-check.js";
import type { CheckoutBrowserCheckResult } from "./checks/browser-check.js";
import type { PricingContractVersion } from "@releasemesh/contracts";
import { runPricingContractCheck } from "./checks/contract-check.js";
import type { MandatoryCheckExecutor, TrustedCheckResult } from "./release-processor.js";
import { resolveTrustedTests } from "./test-registry.js";

export interface DefaultMandatoryCheckExecutorDependencies {
  runBrowserCheck(candidateVersion: PricingContractVersion): Promise<CheckoutBrowserCheckResult>;
  runPricingApiCheck(candidateVersion: PricingContractVersion): Promise<PricingApiCheckResult>;
}

export class DefaultMandatoryCheckExecutor implements MandatoryCheckExecutor {
  public constructor(private readonly dependencies: DefaultMandatoryCheckExecutorDependencies) {}

  public async runMandatoryChecks(
    input: Parameters<MandatoryCheckExecutor["runMandatoryChecks"]>[0]
  ): Promise<TrustedCheckResult[]> {
    const selectedTestIds = new Set(
      resolveTrustedTests(input.selectedTestIds).map(({ id }) => id)
    );
    const results: TrustedCheckResult[] = [];

    if (selectedTestIds.has("contract-pricing")) {
      const contract = runPricingContractCheck(input.candidateVersion);
      results.push({
        artifact: {
          content: JSON.stringify(contract.diff),
          contentType: "application/json",
          kind: "CONTRACT_DIFF"
        },
        hasIncompatibleRegisteredDependency: !contract.passed,
        status: contract.passed ? "PASSED" : "FAILED",
        testId: contract.testId
      });
    }

    if (selectedTestIds.has("api-pricing")) {
      const api = await this.dependencies.runPricingApiCheck(input.candidateVersion);
      if (api.outcome === "error") {
        throw new Error(`Pricing check failed: ${api.errorCode}`);
      }
      results.push({
        artifact: {
          content: JSON.stringify(api),
          contentType: "text/plain",
          kind: "SANITIZED_LOG"
        },
        hasIncompatibleRegisteredDependency: false,
        status: api.outcome === "passed" ? "PASSED" : "FAILED",
        testId: api.testId
      });
    }

    if (selectedTestIds.has("browser-checkout")) {
      const browser = await this.dependencies.runBrowserCheck(input.candidateVersion);
      results.push({
        artifact: {
          content: browser.screenshot,
          contentType: "image/png",
          kind: "SCREENSHOT"
        },
        hasIncompatibleRegisteredDependency: false,
        status: browser.passed ? "PASSED" : "FAILED",
        testId: browser.testId
      });
    }

    return results;
  }
}
