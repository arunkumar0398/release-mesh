export const releaseStatuses = [
  "DRAFT",
  "VALIDATING",
  "QUEUED",
  "TESTING",
  "ANALYZING",
  "SAFE",
  "BLOCKED",
  "ERROR"
] as const;

export type ReleaseStatus = (typeof releaseStatuses)[number];

const allowedTransitions: ReadonlyMap<ReleaseStatus | null, readonly ReleaseStatus[]> = new Map([
  [null, ["DRAFT"]],
  ["DRAFT", ["VALIDATING"]],
  ["VALIDATING", ["QUEUED", "ERROR"]],
  ["QUEUED", ["TESTING", "ERROR"]],
  ["TESTING", ["ANALYZING", "ERROR"]],
  ["ANALYZING", ["SAFE", "BLOCKED", "ERROR"]],
  ["ERROR", ["QUEUED"]]
]);

export function isValidTransition(from: ReleaseStatus | null, to: ReleaseStatus): boolean {
  return allowedTransitions.get(from)?.includes(to) ?? false;
}

export function assertTransition(from: ReleaseStatus | null, to: ReleaseStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid release transition: ${from ?? "INITIAL"} -> ${to}`);
  }
}
