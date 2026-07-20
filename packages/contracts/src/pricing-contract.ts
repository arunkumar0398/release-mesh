export type ContractFieldType = "number" | "string";

export interface ContractField {
  semanticId: string;
  type: ContractFieldType;
}

export interface ObjectContract {
  fields: Readonly<Record<string, ContractField>>;
  version: string;
}

export const pricingContracts = {
  v1: {
    fields: {
      currency: { semanticId: "currency", type: "string" },
      price: { semanticId: "price", type: "number" }
    },
    version: "v1"
  },
  v2: {
    fields: {
      amount: { semanticId: "price", type: "number" },
      currencyCode: { semanticId: "currency", type: "string" }
    },
    version: "v2"
  },
  "v2.1": {
    fields: {
      amount: { semanticId: "price", type: "number" },
      currency: { semanticId: "currency", type: "string" },
      currencyCode: { semanticId: "currency", type: "string" },
      price: { semanticId: "price", type: "number" }
    },
    version: "v2.1"
  }
} as const satisfies Record<"v1" | "v2" | "v2.1", ObjectContract>;

export type PricingContractVersion = keyof typeof pricingContracts;
