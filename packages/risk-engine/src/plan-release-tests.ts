import type { RiskPlanningClient } from "./client.js";
import {
  parsePlanningOutput,
  type PlanningOutput,
  type ReleasePlanningInput
} from "./planning-schema.js";
import { selectAdvisoryTests } from "./select-advisory-tests.js";

export type { ReleasePlanningInput } from "./planning-schema.js";

export type PlanningResult<TestId extends string> = {
  planning: PlanningOutput<TestId>;
  selectedTestIds: TestId[];
  source: "GPT-5.6" | "mandatory/default";
};

export async function planReleaseTests<TestId extends string>({
  client,
  input
}: {
  client: RiskPlanningClient | null;
  input: ReleasePlanningInput<TestId>;
}): Promise<PlanningResult<TestId>> {
  const trustedTestIds = input.trustedTests.map(({ id }) => id);
  const mandatoryTestIds = input.trustedTests
    .filter(({ mandatory }) => mandatory)
    .map(({ id }) => id);
  const fallbackPlanning: PlanningOutput<TestId> = {
    affectedComponents: [],
    advisoryTests: [],
    expectedRiskAreas: []
  };
  const fallback = (): PlanningResult<TestId> => ({
    planning: fallbackPlanning,
    selectedTestIds: selectAdvisoryTests({
      mandatoryTestIds,
      planning: fallbackPlanning,
      trustedTestIds
    }),
    source: "mandatory/default"
  });

  if (client === null) return fallback();

  try {
    const planning = parsePlanningOutput(await client.planTests(input), trustedTestIds);
    return {
      planning,
      selectedTestIds: selectAdvisoryTests({
        mandatoryTestIds,
        planning,
        trustedTestIds
      }),
      source: "GPT-5.6"
    };
  } catch {
    return fallback();
  }
}
