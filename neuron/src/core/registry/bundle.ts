import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import * as tar from "tar"
import { bundleDir, uriToSlug } from "./paths"

export interface BundleMeta {
  uri: string
  task_id: string
  kind: string
  labels: string[]
  feature_shape: number[]
  sample_shape: number[]
  head_arch: number[]
  accuracy: number | null
  hyperparams: Record<string, unknown>
  adapter_hash: string | null
  neuron_version: string
  run_info: { run_id: number; finished_at: number | null }
}

export interface Bundle {
  meta: BundleMeta
  weights: Record<string, { data: number[]; shape: number[] }>
}

export function hashFile(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch {
    return ""
  }
}

export function writeBundle(uri: string, bundle: Bundle): { dir: string; bytes: number } {
  const slug = uriToSlug(uri)
  const dir = bundleDir(slug)
  mkdirSync(dir, { recursive: true })

  const metaPath = join(dir, "meta.json")
  const weightsPath = join(dir, "weights.json")
  const hashPath = join(dir, "adapter.hash")

  writeFileSync(metaPath, JSON.stringify(bundle.meta, null, 2))
  writeFileSync(weightsPath, JSON.stringify(bundle.weights))
  if (bundle.meta.adapter_hash) writeFileSync(hashPath, bundle.meta.adapter_hash)

  const metaBytes = readFileSync(metaPath).byteLength
  const weightsBytes = readFileSync(weightsPath).byteLength
  return { dir, bytes: metaBytes + weightsBytes }
}

export function readBundle(uri: string): Bundle | null {
  const slug = uriToSlug(uri)
  const dir = bundleDir(slug)
  const metaPath = join(dir, "meta.json")
  const weightsPath = join(dir, "weights.json")

  if (!existsSync(metaPath) || !existsSync(weightsPath)) return null

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as BundleMeta
    const weights = JSON.parse(readFileSync(weightsPath, "utf8")) as Record<string, { data: number[]; shape: number[] }>
    return { meta, weights }
  } catch {
    return null
  }
}

export async function packBundleTar(uri: string): Promise<string> {
  const slug = uriToSlug(uri)
  const dir = bundleDir(slug)
  const tarPath = join(dir, "bundle.tar.gz")
  await tar.c({ gzip: true, file: tarPath, cwd: dir }, ["meta.json", "weights.json", "adapter.hash"])
  return tarPath
}
