import { createHash } from "node:crypto"

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex")
}

/**
 * Deterministic hash over a training dataset. Orders samples by id before
 * hashing so two runs with the same data (regardless of insertion order)
 * produce the same digest.
 *
 * Format per sample: `${id}|${label}|${feat1,feat2,...}\n`
 */
export function datasetHash(samples: { id: number; label: string; features: number[] }[]): string {
  const sorted = [...samples].sort((a, b) => a.id - b.id)
  const hash = createHash("sha256")
  for (const s of sorted) {
    hash.update(`${s.id}|${s.label}|${s.features.join(",")}\n`)
  }
  return hash.digest("hex")
}
