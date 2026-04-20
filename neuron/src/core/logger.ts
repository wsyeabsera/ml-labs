import { appendFileSync } from "node:fs"

import { resolve } from "node:path"
const NEURON_ROOT = resolve(import.meta.dir, "../../..")
const LOG_FILE = process.env.NEURON_LOG_FILE ?? resolve(NEURON_ROOT, "data/neuron.log")
const RING_SIZE = 200

export interface LogEntry { ts: number; msg: string }

const ring: LogEntry[] = []

export function log(msg: string) {
  const entry: LogEntry = { ts: Date.now(), msg }
  ring.push(entry)
  if (ring.length > RING_SIZE) ring.shift()
  const line = `[${new Date(entry.ts).toISOString()}] ${msg}\n`
  process.stderr.write(line)
  try { appendFileSync(LOG_FILE, line) } catch { /* non-fatal */ }
}

export function clearLog() { ring.length = 0 }
export function getLog(): LogEntry[] { return [...ring] }
