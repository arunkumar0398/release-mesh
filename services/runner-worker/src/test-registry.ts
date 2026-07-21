export type TrustedTestId = "contract-pricing" | "api-pricing" | "browser-checkout";

export interface TrustedTestDefinition<TestId extends string = TrustedTestId> {
  id: TestId;
  mandatory: boolean;
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
  return selectTrustedTestDefinitions(trustedTestRegistry, advisorySelection);
}

export function selectTrustedTestDefinitions<TestId extends string>(
  registry: Readonly<Record<TestId, TrustedTestDefinition<TestId>>>,
  advisorySelection: readonly string[]
): Array<TrustedTestDefinition<TestId>> {
  for (const testId of advisorySelection) {
    if (!Object.hasOwn(registry, testId)) {
      throw new Error(`Untrusted test id: ${testId}`);
    }
  }

  const selectedIds = new Set(advisorySelection);
  return (Object.values(registry) as Array<TrustedTestDefinition<TestId>>)
    .filter(({ id, mandatory }) => mandatory || selectedIds.has(id));
}
