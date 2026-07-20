import type { ContractFieldType, ObjectContract } from "./pricing-contract.js";

export interface RenamedContractField {
  from: string;
  to: string;
}

export interface ContractTypeMismatch {
  actual: ContractFieldType;
  expected: ContractFieldType;
  field: string;
}

export interface ContractDiff {
  compatible: boolean;
  addedFields: string[];
  missingFields: string[];
  renamedFields: RenamedContractField[];
  typeMismatches: ContractTypeMismatch[];
}

export function diffContract(expected: ObjectContract, actual: ObjectContract): ContractDiff {
  const expectedEntries = Object.entries(expected.fields).sort(([left], [right]) => left.localeCompare(right));
  const actualEntries = Object.entries(actual.fields).sort(([left], [right]) => left.localeCompare(right));
  const missingFields: string[] = [];
  const renamedFields: RenamedContractField[] = [];
  const typeMismatches: ContractTypeMismatch[] = [];

  for (const [field, expectedDefinition] of expectedEntries) {
    const actualDefinition = actual.fields[field];

    if (!actualDefinition) {
      missingFields.push(field);
      const renamedEntry = actualEntries.find(
        ([actualField, definition]) =>
          actualField !== field && definition.semanticId === expectedDefinition.semanticId
      );

      if (renamedEntry) {
        renamedFields.push({ from: field, to: renamedEntry[0] });
      }
      continue;
    }

    if (actualDefinition.type !== expectedDefinition.type) {
      typeMismatches.push({
        actual: actualDefinition.type,
        expected: expectedDefinition.type,
        field
      });
    }
  }

  const addedFields = actualEntries
    .map(([field]) => field)
    .filter((field) => expected.fields[field] === undefined);

  return {
    compatible: missingFields.length === 0 && typeMismatches.length === 0,
    addedFields,
    missingFields,
    renamedFields,
    typeMismatches
  };
}
