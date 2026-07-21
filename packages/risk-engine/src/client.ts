import { analysisOutputJsonSchema } from "./analysis-schema.js";
import {
  createPlanningOutputJsonSchema,
  type ReleasePlanningInput
} from "./planning-schema.js";
import type { SanitizedRiskEvidence } from "./sanitize-evidence.js";

export interface RiskIntelligenceClient {
  analyzeEvidence(evidence: SanitizedRiskEvidence): Promise<unknown>;
}

export interface RiskPlanningClient {
  planTests(input: ReleasePlanningInput): Promise<unknown>;
}

export interface OpenAIRiskIntelligenceClient
  extends RiskIntelligenceClient, RiskPlanningClient {}

export interface OpenAIResponsesClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
}

export class RiskIntelligenceTimeoutError extends Error {
  public constructor() {
    super("GPT-5.6 analysis timed out");
    this.name = "RiskIntelligenceTimeoutError";
  }
}

export function createOpenAIResponsesClient({
  apiKey,
  fetchImpl = fetch,
  model = "gpt-5.6",
  timeoutMs = 8_000
}: OpenAIResponsesClientOptions): OpenAIRiskIntelligenceClient {
  if (apiKey.trim().length === 0) throw new Error("OpenAI API key is required");
  if (model !== "gpt-5.6") {
    throw new Error("Only GPT-5.6 is approved for ReleaseMesh intelligence");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new Error("GPT timeout must be between 1 and 30000 milliseconds");
  }

  const requestStructuredOutput = async ({
    formatName,
    input,
    instructions,
    operation,
    schema
  }: {
    formatName: string;
    input: unknown;
    instructions: string;
    operation: "analysis" | "planning";
    schema: unknown;
  }): Promise<unknown> => {
      const abortController = new AbortController();
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout>;
      const timeoutResult = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          abortController.abort();
          reject(new RiskIntelligenceTimeoutError());
        }, timeoutMs);
      });

      try {
        const response = await Promise.race([
          fetchImpl("https://api.openai.com/v1/responses", {
            body: JSON.stringify({
              input: JSON.stringify(input),
              instructions,
              model,
              reasoning: { effort: "low" },
              store: false,
              text: {
                format: {
                  name: formatName,
                  schema,
                  strict: true,
                  type: "json_schema"
                }
              }
            }),
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            method: "POST",
            redirect: "error",
            signal: abortController.signal
          }),
          timeoutResult
        ]);
        if (!response.ok) throw new Error(`GPT-5.6 ${operation} failed with status ${response.status}`);
        return JSON.parse(extractOutputText(await response.json())) as unknown;
      } catch (error) {
        if (timedOut || error instanceof RiskIntelligenceTimeoutError) {
          throw new RiskIntelligenceTimeoutError();
        }
        throw new Error(`GPT-5.6 ${operation} request failed`, { cause: error });
      } finally {
        clearTimeout(timeout!);
      }
    };

  return {
    analyzeEvidence: (evidence) => requestStructuredOutput({
      formatName: "releasemesh_risk_analysis",
      input: evidence,
      instructions: [
        "Explain the persisted deterministic ReleaseMesh result.",
        "Never approve, block, or change a release gate.",
        "Reference only supplied artifact IDs and propose the smallest compatible remediation."
      ].join(" "),
      operation: "analysis",
      schema: analysisOutputJsonSchema
    }),
    planTests: (input) => requestStructuredOutput({
      formatName: "releasemesh_test_planning",
      input,
      instructions: [
        "Select advisory tests only from the supplied trusted registry.",
        "Never remove a mandatory test or propose arbitrary code, scripts, repositories, or URLs.",
        "Describe affected registered components and expected risk areas from the supplied contract diff, dependency graph, and endpoint."
      ].join(" "),
      operation: "planning",
      schema: createPlanningOutputJsonSchema(input.trustedTests.map(({ id }) => id))
    })
  };
}

function extractOutputText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("output" in payload)) {
    throw new Error("GPT-5.6 response has no output");
  }
  const response = payload as { output?: unknown; status?: unknown };
  if (response.status !== "completed") {
    throw new Error("GPT-5.6 response did not complete");
  }
  const output = response.output;
  if (!Array.isArray(output)) throw new Error("GPT-5.6 response has invalid output");
  let outputText: string | null = null;
  for (const item of output) {
    if (typeof item !== "object" || item === null || !("content" in item)) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object"
        && part !== null
        && (part as { type?: unknown }).type === "refusal"
      ) {
        throw new Error("GPT-5.6 response was refused");
      }
      if (
        typeof part === "object"
        && part !== null
        && (part as { type?: unknown }).type === "output_text"
        && typeof (part as { text?: unknown }).text === "string"
      ) {
        outputText ??= (part as { text: string }).text;
      }
    }
  }
  if (outputText !== null) return outputText;
  throw new Error("GPT-5.6 response has no output text");
}
