import type { ReleaseStatus } from "@releasemesh/contracts";
import type { FastifyInstance } from "fastify";

export type BundledPricingCandidate = "v2" | "v2.1";

export interface ReleaseView {
  attempt: number;
  candidateVersion: BundledPricingCandidate;
  id: string;
  status: ReleaseStatus;
}

export interface ReleaseArtifactView {
  binaryContent: string | null;
  contentType: string;
  createdAt: string;
  id: string;
  jsonContent: unknown;
  kind: string;
  sizeBytes: number;
  testRunId: string | null;
  textContent: string | null;
}

export interface SubmitReleaseInput {
  candidateVersion: BundledPricingCandidate;
  correlationId: string;
  idempotencyKey: string;
}

export interface ReleaseRoutesDependencies {
  getRelease(releaseId: string): Promise<ReleaseView | null>;
  listArtifacts(releaseId: string): Promise<ReleaseArtifactView[]>;
  retryRelease(input: { correlationId: string; releaseId: string }): Promise<ReleaseView>;
  submitRelease(input: SubmitReleaseInput): Promise<{ created: boolean; release: ReleaseView }>;
}

const submitReleaseSchema = {
  body: {
    additionalProperties: false,
    properties: {
      candidateVersion: { enum: ["v2", "v2.1"], type: "string" }
    },
    required: ["candidateVersion"],
    type: "object"
  },
  headers: {
    properties: {
      "idempotency-key": { maxLength: 200, minLength: 1, type: "string" }
    },
    required: ["idempotency-key"],
    type: "object"
  }
} as const;

export function registerReleaseRoutes(
  server: FastifyInstance,
  releases: ReleaseRoutesDependencies
): void {
  server.post<{
    Body: { candidateVersion: BundledPricingCandidate };
    Headers: { "idempotency-key": string };
  }>("/releases", { schema: submitReleaseSchema }, async (request, reply) => {
    const result = await releases.submitRelease({
      candidateVersion: request.body.candidateVersion,
      correlationId: request.id,
      idempotencyKey: request.headers["idempotency-key"]
    });

    return reply.code(result.created ? 201 : 200).send(result.release);
  });

  server.get<{ Params: { releaseId: string } }>(
    "/releases/:releaseId",
    async (request, reply) => {
      const release = await releases.getRelease(request.params.releaseId);
      return release === null ? reply.code(404).send({ message: "Release not found" }) : release;
    }
  );

  server.post<{ Params: { releaseId: string } }>(
    "/releases/:releaseId/retry",
    async (request, reply) => {
      const release = await releases.retryRelease({
        correlationId: request.id,
        releaseId: request.params.releaseId
      });
      return reply.code(202).send(release);
    }
  );

  server.get<{ Params: { releaseId: string } }>(
    "/releases/:releaseId/artifacts",
    async (request) => releases.listArtifacts(request.params.releaseId)
  );
}
