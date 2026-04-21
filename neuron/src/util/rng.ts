/**
 * Seedable PRNG based on mulberry32 — fast, good distribution, deterministic.
 * When seed is undefined we fall back to Math.random for backward compatibility
 * (callers that don't thread a seed get the existing nondeterministic behavior).
 */

export interface Rng {
  next(): number                 // uniform [0, 1)
  int(maxExclusive: number): number
  shuffle<T>(arr: T[]): T[]       // Fisher-Yates in place, returns arr
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed?: number): Rng {
  const next: () => number = seed !== undefined
    ? mulberry32(seed)
    : Math.random

  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive)
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
      }
      return arr
    },
  }
}

/**
 * Resolve a seed from (explicit param) → (NEURON_SEED env var) → undefined.
 * Callers pass the result to createRng().
 */
export function resolveSeed(explicit?: number): number | undefined {
  if (explicit !== undefined) return explicit
  const env = process.env.NEURON_SEED
  if (!env) return undefined
  const parsed = parseInt(env, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}
