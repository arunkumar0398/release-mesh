import type { ArtifactInput } from "@releasemesh/contracts";

import { Prisma } from "../generated/prisma/client.js";

export function toDatabaseArtifactPayload(
  input: ArtifactInput,
  normalized: { content: string | Uint8Array; sizeBytes: number }
) {
  if (typeof normalized.content !== "string") {
    return {
      binaryContent: Uint8Array.from(normalized.content),
      jsonContent: undefined,
      sizeBytes: normalized.sizeBytes,
      textContent: undefined
    };
  }

  if (input.contentType === "application/json") {
    const jsonContent = JSON.parse(normalized.content);
    return {
      binaryContent: undefined,
      jsonContent: jsonContent === null ? Prisma.JsonNull : (jsonContent as Prisma.InputJsonValue),
      sizeBytes: normalized.sizeBytes,
      textContent: undefined
    };
  }

  return {
    binaryContent: undefined,
    jsonContent: undefined,
    sizeBytes: normalized.sizeBytes,
    textContent: normalized.content
  };
}
