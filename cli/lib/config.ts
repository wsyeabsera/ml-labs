import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const CONFIG_PATH = join(ML_LABS_DIR, "config.json")

interface LabsConfig {
  rs_tensor_url: string
}

const DEFAULTS: LabsConfig = {
  rs_tensor_url: "http://localhost:3000/mcp",
}

export function readConfig(): LabsConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeConfig(patch: Partial<LabsConfig>): void {
  const current = readConfig()
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...patch }, null, 2) + "\n")
}

export function rsTensorUrl(): string {
  return readConfig().rs_tensor_url
}
