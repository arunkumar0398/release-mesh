export interface PricingQuote {
  currency: string;
  price: number;
}

export async function fetchPricingQuote(
  pricingBaseUrl: string,
  productId: string,
  candidateVersion?: "v2" | "v2.1"
): Promise<PricingQuote> {
  const pricingUrl = new URL(
    `${pricingBaseUrl.replace(/\/$/, "")}/pricing/${encodeURIComponent(productId)}`
  );
  if (candidateVersion) {
    pricingUrl.searchParams.set("candidateVersion", candidateVersion);
  }
  const response = await fetch(pricingUrl.toString(), undefined);

  if (!response.ok) {
    throw new Error(`Pricing request failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
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

  if (missingFields.length > 0) {
    throw new Error(`Pricing response is incompatible: missing ${missingFields.join(", ")}`);
  }

  const compatiblePayload = payload as Record<string, unknown>;
  return {
    currency: compatiblePayload.currency as string,
    price: compatiblePayload.price as number
  };
}
