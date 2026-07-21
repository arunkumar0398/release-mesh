import type { PlanningOutput } from "./planning-schema.js";

export function selectAdvisoryTests<TestId extends string>({
  mandatoryTestIds,
  planning,
  trustedTestIds
}: {
  mandatoryTestIds: readonly string[];
  planning: PlanningOutput<TestId>;
  trustedTestIds: readonly TestId[];
}): TestId[] {
  const trustedIds = new Set<string>(trustedTestIds);
  const selectedIds: TestId[] = [];
  const appendTrusted = (testId: string, source: "advisory" | "mandatory") => {
    if (!trustedIds.has(testId)) {
      throw new Error(`Untrusted ${source} test id: ${testId}`);
    }
    if (!selectedIds.includes(testId as TestId)) selectedIds.push(testId as TestId);
  };

  mandatoryTestIds.forEach((testId) => appendTrusted(testId, "mandatory"));
  planning.advisoryTests.forEach(({ id }) => appendTrusted(id, "advisory"));
  return selectedIds;
}
