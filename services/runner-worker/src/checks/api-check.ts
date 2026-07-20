export interface PricingApiCheckOptions {
  fetchImpl?: typeof fetch;
  pricingBaseUrl: string;
}

export interface PricingApiCheckResult {
  missingFields: string[];
  passed: boolean;
  statusCode: number;
  testId: "api-pricing";
}

export function createPricingApiCheck({
  fetchImpl = fetch,
  pricingBaseUrl
}: PricingApiCheckOptions): () => Promise<PricingApiCheckResult> {
  const endpoint = `${pricingBaseUrl.replace(/\/$/, "")}/pricing/checkout-demo`;

  return async () => {
    const response = await fetchImpl(endpoint);
    const payload: unknown = response.ok ? await response.json() : null;
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
      passed: response.ok && missingFields.length === 0,
      statusCode: response.status,
      testId: "api-pricing"
    };
  };
}
