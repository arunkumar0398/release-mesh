export type MandatoryTestStatus = "PASSED" | "FAILED";

export interface ReleaseGateInput {
  evidenceComplete: boolean;
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

  if (
    input.hasIncompatibleRegisteredDependency ||
    input.mandatoryTests.some((test) => test.status === "FAILED")
  ) {
    return "BLOCKED";
  }

  return "SAFE";
}
