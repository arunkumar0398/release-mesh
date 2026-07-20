export type ArtifactContent = string | Uint8Array;

interface ArtifactInputBase {
  releaseId: string;
  testRunId?: string;
}

export interface ContractDiffArtifactInput extends ArtifactInputBase {
  content: string;
  contentType: "application/json";
  kind: "CONTRACT_DIFF";
}

export interface SanitizedLogArtifactInput extends ArtifactInputBase {
  content: string;
  contentType: "text/plain";
  kind: "SANITIZED_LOG";
}

export interface ScreenshotArtifactInput extends ArtifactInputBase {
  content: Uint8Array;
  contentType: "image/png";
  kind: "SCREENSHOT";
}

export type ArtifactInput =
  | ContractDiffArtifactInput
  | SanitizedLogArtifactInput
  | ScreenshotArtifactInput;

export interface StoredArtifact {
  contentType: string;
  id: string;
  kind: string;
  releaseId: string;
  sizeBytes: number;
  testRunId?: string;
}

export interface RetrievedArtifact extends StoredArtifact {
  content: ArtifactContent;
}

export interface ArtifactStore {
  get(id: string): Promise<RetrievedArtifact | null>;
  put(input: ArtifactInput): Promise<StoredArtifact>;
}
