export type ArtifactContent = string | Uint8Array;

export interface ArtifactInput {
  content: ArtifactContent;
  contentType: string;
  kind: string;
  releaseId: string;
  testRunId?: string;
}

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
