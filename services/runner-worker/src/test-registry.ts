export type TrustedTestId = "contract-pricing" | "api-pricing" | "browser-checkout";

export interface TrustedTestDefinition {
  id: TrustedTestId;
  mandatory: true;
  type: "contract" | "api" | "browser";
}

export const trustedTestRegistry = {
  "contract-pricing": {
    id: "contract-pricing",
    mandatory: true,
    type: "contract"
  },
  "api-pricing": {
    id: "api-pricing",
    mandatory: true,
    type: "api"
  },
  "browser-checkout": {
    id: "browser-checkout",
    mandatory: true,
    type: "browser"
  }
} as const satisfies Record<TrustedTestId, TrustedTestDefinition>;

export function resolveTrustedTests(advisorySelection: readonly string[]): TrustedTestDefinition[] {
  for (const testId of advisorySelection) {
    if (!Object.hasOwn(trustedTestRegistry, testId)) {
      throw new Error(`Untrusted test id: ${testId}`);
    }
  }

  return Object.values(trustedTestRegistry);
}
