import {
  diffContract,
  pricingContracts,
  type ContractDiff,
  type PricingContractVersion
} from "@releasemesh/contracts";

export interface PricingContractCheckResult {
  candidateVersion: PricingContractVersion;
  diff: ContractDiff;
  expectedVersion: "v1";
  passed: boolean;
  testId: "contract-pricing";
}

export function runPricingContractCheck(
  candidateVersion: PricingContractVersion
): PricingContractCheckResult {
  const diff = diffContract(pricingContracts.v1, pricingContracts[candidateVersion]);

  return {
    candidateVersion,
    diff,
    expectedVersion: "v1",
    passed: diff.compatible,
    testId: "contract-pricing"
  };
}
