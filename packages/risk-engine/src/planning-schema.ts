import type { ContractDiff } from "@releasemesh/contracts";

export interface AdvisoryTestSelection<TestId extends string = string> {
  id: TestId;
  reason: string;
}

export interface PlanningOutput<TestId extends string = string> {
  affectedComponents: string[];
  advisoryTests: Array<AdvisoryTestSelection<TestId>>;
  expectedRiskAreas: string[];
}

export interface ReleasePlanningInput<TestId extends string = string> {
  changedEndpoints: ReadonlyArray<{ method: "GET"; path: string }>;
  contractDiff: ContractDiff;
  dependencyGraph: ReadonlyArray<{
    consumer: string;
    expectedContractVersion: string;
    provider: string;
    requiredEndpoints: readonly string[];
  }>;
  trustedTests: ReadonlyArray<{
    id: TestId;
    mandatory: boolean;
    type: "api" | "browser" | "contract";
  }>;
}

const planningOutputKeys = ["affectedComponents", "advisoryTests", "expectedRiskAreas"] as const;
const advisoryTestKeys = ["id", "reason"] as const;

export function createPlanningOutputJsonSchema(trustedTestIds: readonly string[]) {
  const uniqueTrustedTestIds = [...new Set(trustedTestIds)];
  if (uniqueTrustedTestIds.length === 0 || uniqueTrustedTestIds.length !== trustedTestIds.length) {
    throw new Error("Trusted planning test IDs must be non-empty and unique");
  }

  return {
    additionalProperties: false,
    properties: {
      affectedComponents: boundedStringArraySchema(),
      advisoryTests: {
        items: {
          additionalProperties: false,
          properties: {
            id: { enum: uniqueTrustedTestIds, type: "string" },
            reason: boundedStringSchema()
          },
          required: ["id", "reason"],
          type: "object"
        },
        maxItems: 20,
        type: "array"
      },
      expectedRiskAreas: boundedStringArraySchema()
    },
    required: [...planningOutputKeys],
    type: "object"
  } as const;
}

export function parsePlanningOutput<TestId extends string>(
  value: unknown,
  trustedTestIds: readonly TestId[]
): PlanningOutput<TestId> {
  try {
    const output = requireRecord(value);
    requireExactKeys(output, planningOutputKeys);
    const affectedComponents = requireStringArray(output.affectedComponents);
    const expectedRiskAreas = requireStringArray(output.expectedRiskAreas);
    const trustedIds = new Set<string>(trustedTestIds);
    const selectedIds = new Set<string>();
    if (!Array.isArray(output.advisoryTests) || output.advisoryTests.length > 20) {
      throw new Error("advisoryTests must be a bounded array");
    }
    const advisoryTests = output.advisoryTests.map((selection) => {
      const entry = requireRecord(selection);
      requireExactKeys(entry, advisoryTestKeys);
      const id = requireBoundedString(entry.id);
      if (!trustedIds.has(id) || selectedIds.has(id)) {
        throw new Error("advisory test id must be unique and trusted");
      }
      selectedIds.add(id);
      return {
        id: id as TestId,
        reason: requireBoundedString(entry.reason)
      };
    });

    return { affectedComponents, advisoryTests, expectedRiskAreas };
  } catch (error) {
    throw new Error("Invalid GPT planning output", { cause: error });
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("value must be an object");
  }
  return value as Record<string, unknown>;
}

function boundedStringSchema() {
  return { maxLength: 500, minLength: 1, type: "string" } as const;
}

function boundedStringArraySchema() {
  return {
    items: boundedStringSchema(),
    maxItems: 20,
    type: "array"
  } as const;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): void {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error("value has unexpected properties");
  }
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("value must be a bounded array");
  }
  const strings = value.map(requireBoundedString);
  if (new Set(strings).size !== strings.length) {
    throw new Error("array values must be unique");
  }
  return strings;
}

function requireBoundedString(value: unknown): string {
  if (typeof value !== "string") throw new Error("value must be a string");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 500) {
    throw new Error("string must be between 1 and 500 characters");
  }
  return normalized;
}
