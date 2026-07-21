import type { PricingCandidate } from "./api.js";

interface CryptoProvider {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
}

const pendingKeyPrefix = "releasemesh.pending-release.";

export function createReleaseIdempotencyKey(
  candidateVersion: PricingCandidate,
  cryptoProvider: CryptoProvider = globalThis.crypto
): string {
  const normalizedVersion = candidateVersion.replace(".", "-");
  const uuid = cryptoProvider.randomUUID?.() ?? createUuid(cryptoProvider);
  return `release-${normalizedVersion}-${Date.now()}-${uuid}`;
}

function createUuid(cryptoProvider: CryptoProvider): string {
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readPendingSubmissionKey(
  candidateVersion: PricingCandidate,
  storage: Pick<Storage, "getItem"> = globalThis.sessionStorage
): string | null {
  try {
    return storage.getItem(storageKey(candidateVersion));
  } catch {
    return null;
  }
}

export function writePendingSubmissionKey(
  candidateVersion: PricingCandidate,
  key: string,
  storage: Pick<Storage, "setItem"> = globalThis.sessionStorage
): void {
  try {
    storage.setItem(storageKey(candidateVersion), key);
  } catch {
    return;
  }
}

export function clearPendingSubmissionKey(
  candidateVersion: PricingCandidate,
  storage: Pick<Storage, "removeItem"> = globalThis.sessionStorage
): void {
  try {
    storage.removeItem(storageKey(candidateVersion));
  } catch {
    return;
  }
}

function storageKey(candidateVersion: PricingCandidate): string {
  return `${pendingKeyPrefix}${candidateVersion}`;
}
