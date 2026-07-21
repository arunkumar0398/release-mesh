import { diffContract, pricingContracts } from "@releasemesh/contracts";

import { analyzeRisk } from "./analyze-risk.js";
import { createOpenAIResponsesClient } from "./client.js";
import { planReleaseTests } from "./plan-release-tests.js";

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live AI smoke test");
const client = createOpenAIResponsesClient({
  apiKey,
  model: process.env.OPENAI_MODEL?.trim() || "gpt-5.6",
  timeoutMs: Number.parseInt(process.env.OPENAI_TIMEOUT_MS ?? "8000", 10)
});

const planning = await planReleaseTests({
  client,
  input: {
    changedEndpoints: [{ method: "GET", path: "/pricing/:productId" }],
    contractDiff: diffContract(pricingContracts.v1, pricingContracts.v2),
    dependencyGraph: [{
      consumer: "checkout",
      expectedContractVersion: "v1",
      provider: "pricing",
      requiredEndpoints: ["GET /pricing/:productId"]
    }],
    trustedTests: [
      { id: "contract-pricing", mandatory: true, type: "contract" },
      { id: "api-pricing", mandatory: true, type: "api" },
      { id: "browser-checkout", mandatory: true, type: "browser" }
    ]
  }
});
if (planning.source !== "GPT-5.6") {
  throw new Error("GPT-5.6 smoke test returned mandatory planning fallback");
}

const result = await analyzeRisk({
  client,
  evidence: {
    apiAssertions: {
      artifactId: "smoke-api-evidence",
      result: { missingFields: ["price", "currency"], outcome: "failed" }
    },
    browser: {
      artifactId: "smoke-browser-evidence",
      screenshot: { contentType: "image/png", sizeBytes: 14_477 },
      summary: "Checkout rendered the expected Pricing compatibility error."
    },
    contractDiff: {
      artifactId: "smoke-contract-evidence",
      result: {
        compatible: false,
        renamedFields: [
          { from: "price", to: "amount" },
          { from: "currency", to: "currencyCode" }
        ]
      }
    },
    deterministicGate: "BLOCKED",
    ownership: [
      { component: "checkout", ownerTeam: "checkout-platform" },
      { component: "pricing", ownerTeam: "pricing-platform" }
    ],
    releaseId: "gpt-5.6-smoke",
    sanitizedLogs: []
  }
});

if (result.status !== "AVAILABLE") {
  throw new Error("GPT-5.6 smoke test returned deterministic fallback instead of validated AI output");
}

console.log(JSON.stringify({
  confidence: result.assessment.confidence,
  planningSource: planning.source,
  rootCause: result.assessment.rootCause,
  selectedTestIds: planning.selectedTestIds,
  source: result.source,
  status: result.status
}, null, 2));
