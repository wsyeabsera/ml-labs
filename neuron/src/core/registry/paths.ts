import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const NEURON_HOME = process.env.NEURON_HOME ?? join(homedir(), ".neuron")
export const REGISTRY_DIR = join(NEURON_HOME, "registry")
export const BUNDLES_DIR = join(REGISTRY_DIR, "bundles")
export const REGISTRY_DB_PATH = join(REGISTRY_DIR, "registry.db")

export function ensureRegistryDirs() {
  mkdirSync(BUNDLES_DIR, { recursive: true })
}

export function bundleDir(uriSlug: string): string {
  return join(BUNDLES_DIR, uriSlug)
}

export function uriToSlug(uri: string): string {
  return uri.replace(/^neuron:\/\//, "").replace(/[^a-zA-Z0-9._@-]/g, "_")
}
