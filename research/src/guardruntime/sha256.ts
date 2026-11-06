import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

/** Stable synchronous SHA-256 backed by the audited @noble/hashes implementation. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return Array.from(nobleSha256(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Stable stringify so hashes don't depend on key insertion order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}
