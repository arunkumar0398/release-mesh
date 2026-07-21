import { describe, expect, it, vi } from "vitest";

import {
  createOpenAIResponsesClient,
  RiskIntelligenceTimeoutError
} from "./client.js";
import type { ReleasePlanningInput } from "./planning-schema.js";
import type { SanitizedRiskEvidence } from "./sanitize-evidence.js";

const evidence = {
  apiAssertions: null,
  browser: null,
  contractDiff: null,
  deterministicGate: "SAFE",
  ownership: [],
  releaseId: "release-123",
  sanitizedLogs: []
} satisfies SanitizedRiskEvidence;

const planningInput = {
  changedEndpoints: [{ method: "GET", path: "/pricing/:productId" }],
  contractDiff: {
    addedFields: [],
    compatible: false,
    missingFields: ["currency", "price"],
    renamedFields: [],
    typeMismatches: []
  },
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
} satisfies ReleasePlanningInput;

describe("createOpenAIResponsesClient", () => {
  it("uses GPT-5.6 structured output without exposing credentials in the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        content: [{
          text: JSON.stringify({
            blastRadius: [],
            compatibleRemediation: "No compatibility change is required.",
            confidence: "HIGH",
            evidenceLinks: [],
            rootCause: "Mandatory checks passed.",
            uncertainty: "Only registered dependencies were evaluated.",
            verificationSteps: ["Retain all mandatory checks."]
          }),
          type: "output_text"
        }],
        type: "message"
      }],
      status: "completed"
    }), { headers: { "content-type": "application/json" }, status: 200 }));
    const client = createOpenAIResponsesClient({
      apiKey: "server-side-secret",
      fetchImpl,
      timeoutMs: 100
    });

    await expect(client.analyzeEvidence(evidence)).resolves.toMatchObject({ confidence: "HIGH" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ Authorization: "Bearer server-side-secret" });
    expect(body).toMatchObject({ model: "gpt-5.6", store: false });
    expect(body).toHaveProperty("text.format.type", "json_schema");
    expect(JSON.stringify(body)).not.toContain("server-side-secret");
  });

  it("aborts and rejects a response that exceeds the configured timeout", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(
        new DOMException("Aborted", "AbortError")
      ))
    )) as unknown as typeof fetch;
    const client = createOpenAIResponsesClient({
      apiKey: "server-side-secret",
      fetchImpl,
      timeoutMs: 5
    });

    await expect(client.analyzeEvidence(evidence)).rejects.toBeInstanceOf(RiskIntelligenceTimeoutError);
  });

  it("requests advisory planning with an allowlisted structured-output schema", async () => {
    const planning = {
      affectedComponents: ["checkout"],
      advisoryTests: [{ id: "browser-checkout", reason: "Affected consumer test." }],
      expectedRiskAreas: ["Checkout rendering"]
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        content: [{ text: JSON.stringify(planning), type: "output_text" }],
        type: "message"
      }],
      status: "completed"
    }), { status: 200 }));
    const client = createOpenAIResponsesClient({
      apiKey: "server-side-secret",
      fetchImpl,
      timeoutMs: 100
    });

    await expect(client.planTests(planningInput)).resolves.toEqual(planning);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toHaveProperty("text.format.name", "releasemesh_test_planning");
    expect(body).toHaveProperty(
      "text.format.schema.properties.advisoryTests.items.properties.id.enum",
      ["contract-pricing", "api-pricing", "browser-checkout"]
    );
    expect(body).not.toHaveProperty("gate");
  });

  it("rejects a model that cannot be attributed to GPT-5.6", () => {
    expect(() => createOpenAIResponsesClient({
      apiKey: "server-side-secret",
      model: "gpt-5.5"
    })).toThrow("Only GPT-5.6 is approved for ReleaseMesh intelligence");
  });

  it("rejects an incomplete response before reading output text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        content: [{ text: "{}", type: "output_text" }],
        type: "message"
      }],
      status: "incomplete"
    }), { status: 200 }));
    const client = createOpenAIResponsesClient({
      apiKey: "server-side-secret",
      fetchImpl,
      timeoutMs: 100
    });

    await expect(client.analyzeEvidence(evidence)).rejects.toThrow(
      "GPT-5.6 analysis request failed"
    );
  });

  it("rejects a refusal instead of accepting adjacent output text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        content: [
          { refusal: "I cannot analyze this evidence.", type: "refusal" },
          { text: "{}", type: "output_text" }
        ],
        type: "message"
      }],
      status: "completed"
    }), { status: 200 }));
    const client = createOpenAIResponsesClient({
      apiKey: "server-side-secret",
      fetchImpl,
      timeoutMs: 100
    });

    await expect(client.analyzeEvidence(evidence)).rejects.toThrow(
      "GPT-5.6 analysis request failed"
    );
  });
});
