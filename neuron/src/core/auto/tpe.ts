/**
 * Tree-structured Parzen Estimator (TPE) for hyperparameter search.
 *
 * Given a history of (config, score) observations, TPE splits them into
 * "good" (top γ fraction by score) and "bad" sets, then samples new configs
 * by drawing from a kernel density estimate of the good set (with slight
 * perturbation so we explore around known-good regions rather than just
 * replaying).
 *
 * This implementation is intentionally minimal — not a full KDE + Parzen
 * window model, but a weighted-resampling variant that matches the practical
 * behaviour of TPE on small sample counts (<100 observations), which is our
 * regime. Simpler, deterministic, no new deps.
 *
 * Reference: Bergstra et al. 2011; cheap-and-cheerful variant inspired by
 * Optuna's default behavior on short studies.
 */

import { createRng, type Rng } from "../../util/rng"

export type ParamSpace =
  | { kind: "log_uniform"; min: number; max: number }
  | { kind: "uniform"; min: number; max: number }
  | { kind: "int_uniform"; min: number; max: number }
  | { kind: "categorical"; choices: readonly string[] }

export interface TpeParamSpec {
  [key: string]: ParamSpace
}

export interface TpeObservation {
  config: Record<string, number | string>
  score: number  // higher is better; use -score if lower is better
}

export interface TpeOptions {
  gamma?: number           // fraction of observations classified as "good" (default 0.25)
  jitter?: number          // perturbation around resampled value (default 0.15)
  seed?: number
}

/**
 * Sample the next config given history + search space.
 * When history is empty or has < 3 observations, falls back to uniform sampling.
 */
export function suggestTpe(
  space: TpeParamSpec,
  history: TpeObservation[],
  opts: TpeOptions = {},
): Record<string, number | string> {
  const rng = createRng(opts.seed)
  const gamma = opts.gamma ?? 0.25
  const jitter = opts.jitter ?? 0.15

  // Too little history → uniform sampling (cold start).
  if (history.length < 3) {
    return sampleUniform(space, rng)
  }

  // Rank + split into good (top γ) / bad (bottom 1-γ).
  const sorted = [...history].sort((a, b) => b.score - a.score)
  const nGood = Math.max(1, Math.floor(sorted.length * gamma))
  const good = sorted.slice(0, nGood)

  // Sample each param: draw from a good observation, then perturb.
  const result: Record<string, number | string> = {}
  for (const [key, paramSpec] of Object.entries(space)) {
    const pick = good[rng.int(good.length)]!
    const baseVal = pick.config[key]
    result[key] = perturbValue(paramSpec, baseVal, jitter, rng)
  }
  return result
}

function sampleUniform(space: TpeParamSpec, rng: Rng): Record<string, number | string> {
  const result: Record<string, number | string> = {}
  for (const [key, spec] of Object.entries(space)) {
    result[key] = sampleSpace(spec, rng)
  }
  return result
}

function sampleSpace(spec: ParamSpace, rng: Rng): number | string {
  switch (spec.kind) {
    case "log_uniform": {
      const logMin = Math.log(spec.min)
      const logMax = Math.log(spec.max)
      return Math.exp(logMin + rng.next() * (logMax - logMin))
    }
    case "uniform":
      return spec.min + rng.next() * (spec.max - spec.min)
    case "int_uniform":
      return Math.round(spec.min + rng.next() * (spec.max - spec.min))
    case "categorical":
      return spec.choices[rng.int(spec.choices.length)]!
  }
}

function perturbValue(
  spec: ParamSpace,
  baseVal: number | string | undefined,
  jitter: number,
  rng: Rng,
): number | string {
  // If the historical config didn't have this key, just sample uniformly.
  if (baseVal === undefined) return sampleSpace(spec, rng)

  switch (spec.kind) {
    case "log_uniform": {
      const v = typeof baseVal === "number" ? baseVal : spec.min
      const logV = Math.log(Math.max(spec.min, v))
      const logMin = Math.log(spec.min)
      const logMax = Math.log(spec.max)
      const logRange = logMax - logMin
      const perturbed = logV + (rng.next() - 0.5) * 2 * jitter * logRange
      return Math.exp(clampVal(perturbed, logMin, logMax))
    }
    case "uniform": {
      const v = typeof baseVal === "number" ? baseVal : spec.min
      const range = spec.max - spec.min
      const perturbed = v + (rng.next() - 0.5) * 2 * jitter * range
      return clampVal(perturbed, spec.min, spec.max)
    }
    case "int_uniform": {
      const v = typeof baseVal === "number" ? baseVal : spec.min
      const range = spec.max - spec.min
      const perturbed = v + (rng.next() - 0.5) * 2 * jitter * range
      return Math.round(clampVal(perturbed, spec.min, spec.max))
    }
    case "categorical":
      // 70% keep, 30% explore another choice.
      if (rng.next() < 0.7 && typeof baseVal === "string") return baseVal
      return spec.choices[rng.int(spec.choices.length)]!
  }
}

function clampVal(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Generate N distinct candidate configs from the TPE posterior. Useful when
 * the controller wants a wave of 3-4 suggestions rather than one-at-a-time.
 */
export function suggestTpeBatch(
  space: TpeParamSpec,
  history: TpeObservation[],
  n: number,
  opts: TpeOptions = {},
): Record<string, number | string>[] {
  const baseSeed = opts.seed ?? 42
  const results: Record<string, number | string>[] = []
  for (let i = 0; i < n; i++) {
    results.push(suggestTpe(space, history, { ...opts, seed: baseSeed + i * 1009 }))
  }
  return results
}
