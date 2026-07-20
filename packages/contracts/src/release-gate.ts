export type MandatoryTestStatus = "PASSED" | "FAILED";

export interface ReleaseGateInput {
  evidenceComplete: boolean;
  expectedMandatoryTestIds: readonly string[];
  hasIncompatibleRegisteredDependency: boolean;
  mandatoryTests: readonly {
    id: string;
    status: MandatoryTestStatus;
  }[];
  requiredChecksCompleted: boolean;
}

export type DeterministicReleaseGate = "SAFE" | "BLOCKED" | "ERROR";

export function decideReleaseGate(input: ReleaseGateInput): DeterministicReleaseGate {
  if (!input.requiredChecksCompleted || !input.evidenceComplete) {
    return "ERROR";
  }

  const expectedTestIds = new Set(input.expectedMandatoryTestIds);
  const receivedTestIds = new Set<string>();
  if (
    expectedTestIds.size === 0 ||
    expectedTestIds.size !== input.expectedMandatoryTestIds.length ||
    input.mandatoryTests.length !== expectedTestIds.size ||
    input.mandatoryTests.some((test) => {
      if (!expectedTestIds.has(test.id) || receivedTestIds.has(test.id)) {
        return true;
      }

      receivedTestIds.add(test.id);
      return false;
    })
  ) {
    return "ERROR";
  }

  if (
    input.hasIncompatibleRegisteredDependency ||
    input.mandatoryTests.some((test) => test.status === "FAILED")
  ) {
    return "BLOCKED";
  }

  return "SAFE";
}
