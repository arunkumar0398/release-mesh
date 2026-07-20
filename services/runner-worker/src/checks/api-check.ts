export interface PricingApiCheckOptions {
  fetchImpl?: typeof fetch;
  pricingBaseUrl: string;
  timeoutMs?: number;
}

interface PricingApiCheckBaseResult {
  testId: "api-pricing";
}

export interface PricingApiCheckPassedResult extends PricingApiCheckBaseResult {
  missingFields: string[];
  outcome: "passed";
  statusCode: number;
}

export interface PricingApiCheckFailedResult extends PricingApiCheckBaseResult {
  missingFields: string[];
  outcome: "failed";
  statusCode: number;
}

export type PricingApiCheckErrorCode =
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "NETWORK_ERROR"
  | "TIMEOUT";

export interface PricingApiCheckErrorResult extends PricingApiCheckBaseResult {
  errorCode: PricingApiCheckErrorCode;
  outcome: "error";
  statusCode: number | null;
}

export type PricingApiCheckResult =
  | PricingApiCheckPassedResult
  | PricingApiCheckFailedResult
  | PricingApiCheckErrorResult;

export type PricingApiGateState =
  | { requiredChecksCompleted: false }
  | {
      mandatoryTestStatus: "PASSED" | "FAILED";
      requiredChecksCompleted: true;
    };

export function toPricingApiGateState(result: PricingApiCheckResult): PricingApiGateState {
  if (result.outcome === "error") {
    return { requiredChecksCompleted: false };
  }

  return {
    mandatoryTestStatus: result.outcome === "passed" ? "PASSED" : "FAILED",
    requiredChecksCompleted: true
  };
}

function createErrorResult(
  errorCode: PricingApiCheckErrorCode,
  statusCode: number | null
): PricingApiCheckErrorResult {
  return {
    errorCode,
    outcome: "error",
    statusCode,
    testId: "api-pricing"
  };
}

async function executePricingApiCheck(
  endpoint: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<PricingApiCheckResult> {
  let response: Response;

  try {
    response = await fetchImpl(endpoint, { signal });
  } catch {
    return createErrorResult(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR", null);
  }

  if (!response.ok) {
    return createErrorResult("HTTP_ERROR", response.status);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return createErrorResult(signal.aborted ? "TIMEOUT" : "INVALID_JSON", response.status);
  }

  const missingFields: string[] = [];

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).price !== "number"
  ) {
    missingFields.push("price");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).currency !== "string"
  ) {
    missingFields.push("currency");
  }

  return {
    missingFields,
    outcome: missingFields.length === 0 ? "passed" : "failed",
    statusCode: response.status,
    testId: "api-pricing"
  };
}

export function createPricingApiCheck({
  fetchImpl = fetch,
  pricingBaseUrl,
  timeoutMs = 5_000
}: PricingApiCheckOptions): () => Promise<PricingApiCheckResult> {
  const endpoint = `${pricingBaseUrl.replace(/\/$/, "")}/pricing/checkout-demo`;

  return async () => {
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const timeoutResult = new Promise<PricingApiCheckErrorResult>((resolve) => {
      timeout = setTimeout(() => {
        abortController.abort();
        resolve(createErrorResult("TIMEOUT", null));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        executePricingApiCheck(endpoint, fetchImpl, abortController.signal),
        timeoutResult
      ]);
    } finally {
      clearTimeout(timeout!);
    }
  };
}
