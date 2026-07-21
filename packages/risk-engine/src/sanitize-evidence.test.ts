import { describe, expect, it } from "vitest";

import { sanitizeEvidence, type RiskEvidenceInput } from "./sanitize-evidence.js";

describe("sanitizeEvidence", () => {
  it("redacts credentials across structured evidence without changing metadata", () => {
    const evidence: RiskEvidenceInput = {
      apiAssertions: {
        artifactId: "api-artifact",
        result: {
          endpoint: "postgresql://release:database-secret@db.internal/releasemesh",
          headers: "Authorization: Bearer api-secret"
        }
      },
      browser: {
        artifactId: "browser-artifact",
        screenshot: { contentType: "image/png", sizeBytes: 2048 },
        summary: "Cookie: session=browser-secret"
      },
      contractDiff: {
        artifactId: "contract-artifact",
        result: { compatible: false }
      },
      deterministicGate: "BLOCKED",
      ownership: [{ component: "checkout", ownerTeam: "checkout-platform" }],
      releaseId: "release-123",
      sanitizedLogs: [{
        artifactId: "log-artifact",
        content: "REDIS_URL=redis://default:redis-secret@cache:6379 AWS_SECRET_ACCESS_KEY=cloud-secret"
      }]
    };

    const sanitized = sanitizeEvidence(evidence);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("database-secret");
    expect(serialized).not.toContain("api-secret");
    expect(serialized).not.toContain("browser-secret");
    expect(serialized).not.toContain("redis-secret");
    expect(serialized).not.toContain("cloud-secret");
    expect(serialized).toContain("[REDACTED]");
    expect(sanitized.browser?.screenshot).toEqual({ contentType: "image/png", sizeBytes: 2048 });
  });

  it("copies only the supported screenshot metadata fields", () => {
    const evidence = {
      apiAssertions: null,
      browser: {
        artifactId: "browser-artifact",
        binaryContent: "secret-screenshot-bytes",
        screenshot: { contentType: "image/png", sizeBytes: 512 },
        summary: "Checkout failed predictably."
      },
      contractDiff: null,
      deterministicGate: "BLOCKED",
      ownership: [],
      releaseId: "release-123",
      sanitizedLogs: []
    } as unknown as RiskEvidenceInput;

    expect(JSON.stringify(sanitizeEvidence(evidence))).not.toContain("secret-screenshot-bytes");
  });

  it("drops untrusted fields from JSON logs before model submission", () => {
    const evidence: RiskEvidenceInput = {
      apiAssertions: null,
      browser: null,
      contractDiff: null,
      deterministicGate: "ERROR",
      ownership: [],
      releaseId: "release-json-log",
      sanitizedLogs: [{
        artifactId: "log-artifact",
        content: JSON.stringify({
          authorization: "Bearer quoted-secret",
          credential: "unclassified-log-secret",
          message: "request failed with token sk-proj-opaqueSecret123456",
          nested: { cookie: "session=quoted-cookie" }
        })
      }]
    };

    const sanitized = sanitizeEvidence(evidence);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("quoted-secret");
    expect(serialized).not.toContain("unclassified-log-secret");
    expect(serialized).not.toContain("opaqueSecret123456");
    expect(serialized).not.toContain("quoted-cookie");
    expect(sanitized.sanitizedLogs[0]?.content).toBe("{}");
  });

  it("drops unknown structured evidence fields before model submission", () => {
    const evidence: RiskEvidenceInput = {
      apiAssertions: {
        artifactId: "api-artifact",
        result: {
          internalPayload: { credential: "unclassified-secret" },
          missingFields: ["price"],
          outcome: "failed",
          statusCode: 200
        }
      },
      browser: null,
      contractDiff: {
        artifactId: "contract-artifact",
        result: {
          compatible: false,
          internalNotes: "do-not-send",
          missingFields: ["price"]
        }
      },
      deterministicGate: "BLOCKED",
      ownership: [],
      releaseId: "release-allowlist",
      sanitizedLogs: []
    };

    const sanitized = sanitizeEvidence(evidence);

    expect(sanitized.apiAssertions?.result).toEqual({
      missingFields: ["price"],
      outcome: "failed",
      statusCode: 200
    });
    expect(sanitized.contractDiff?.result).toEqual({
      compatible: false,
      missingFields: ["price"]
    });
    expect(JSON.stringify(sanitized)).not.toContain("unclassified-secret");
    expect(JSON.stringify(sanitized)).not.toContain("do-not-send");
  });

  it("drops malformed and truncated structured logs instead of regex-sanitizing them", () => {
    const oversized = JSON.stringify({
      authorization: "Bearer oversized-secret",
      padding: "x".repeat(17_000)
    });
    const evidence: RiskEvidenceInput = {
      apiAssertions: null,
      browser: null,
      contractDiff: null,
      deterministicGate: "ERROR",
      ownership: [],
      releaseId: "release-malformed-log",
      sanitizedLogs: [
        { artifactId: "malformed", content: "{\"authorization\":\"Bearer malformed-secret\"" },
        { artifactId: "oversized", content: oversized }
      ]
    };

    const sanitized = sanitizeEvidence(evidence);

    expect(sanitized.sanitizedLogs.map(({ content }) => content)).toEqual([
      "[REDACTED: INVALID STRUCTURED LOG]",
      "[REDACTED: INVALID STRUCTURED LOG]"
    ]);
    expect(JSON.stringify(sanitized)).not.toContain("malformed-secret");
    expect(JSON.stringify(sanitized)).not.toContain("oversized-secret");
  });
});
