export type PricingMode = "v1" | "v2" | "v2.1";

const pricingModes = new Set<PricingMode>(["v1", "v2", "v2.1"]);

export function parsePricingMode(value: string | undefined): PricingMode {
  if (value === undefined || value === "") {
    return "v1";
  }

  if (pricingModes.has(value as PricingMode)) {
    return value as PricingMode;
  }

  throw new Error(`Unsupported Pricing mode: ${value}`);
}
