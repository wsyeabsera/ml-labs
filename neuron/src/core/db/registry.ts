import { Database } from "bun:sqlite"
import { ensureRegistryDirs, REGISTRY_DB_PATH } from "../registry/paths"

ensureRegistryDirs()

export const registryDb = new Database(REGISTRY_DB_PATH, { create: true })
registryDb.exec("PRAGMA journal_mode=WAL")

registryDb.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    uri             TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    version         TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    tags            TEXT NOT NULL DEFAULT '[]',
    task_kind       TEXT NOT NULL,
    feature_shape   TEXT NOT NULL,
    sample_shape    TEXT NOT NULL,
    accuracy        REAL,
    adapter_hash    TEXT,
    bundle_path     TEXT NOT NULL,
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

export interface RegistryEntry {
  uri: string
  name: string
  version: string
  description: string
  tags: string[]
  taskKind: string
  featureShape: number[]
  sampleShape: number[]
  accuracy: number | null
  adapterHash: string | null
  bundlePath: string
  createdAt: number
}

interface DbRow {
  uri: string; name: string; version: string; description: string; tags: string
  task_kind: string; feature_shape: string; sample_shape: string; accuracy: number | null
  adapter_hash: string | null; bundle_path: string; metadata_json: string; created_at: number
}

function rowToEntry(r: DbRow): RegistryEntry {
  return {
    uri: r.uri, name: r.name, version: r.version, description: r.description,
    tags: JSON.parse(r.tags) as string[],
    taskKind: r.task_kind,
    featureShape: JSON.parse(r.feature_shape) as number[],
    sampleShape: JSON.parse(r.sample_shape) as number[],
    accuracy: r.accuracy, adapterHash: r.adapter_hash,
    bundlePath: r.bundle_path, createdAt: r.created_at,
  }
}

export function upsertEntry(e: RegistryEntry) {
  registryDb.prepare(`
    INSERT INTO entries (uri, name, version, description, tags, task_kind, feature_shape, sample_shape,
      accuracy, adapter_hash, bundle_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uri) DO UPDATE SET
      name=excluded.name, version=excluded.version, description=excluded.description,
      tags=excluded.tags, accuracy=excluded.accuracy, adapter_hash=excluded.adapter_hash,
      bundle_path=excluded.bundle_path, created_at=excluded.created_at
  `).run(
    e.uri, e.name, e.version, e.description,
    JSON.stringify(e.tags), e.taskKind,
    JSON.stringify(e.featureShape), JSON.stringify(e.sampleShape),
    e.accuracy, e.adapterHash, e.bundlePath, e.createdAt,
  )
}

export function getEntry(uri: string): RegistryEntry | null {
  const row = registryDb.query("SELECT * FROM entries WHERE uri = ?").get(uri) as DbRow | null
  return row ? rowToEntry(row) : null
}

export function listEntries(filter?: { kind?: string; tag?: string }): RegistryEntry[] {
  let sql = "SELECT * FROM entries"
  const params: unknown[] = []
  const conditions: string[] = []
  if (filter?.kind) { conditions.push("task_kind = ?"); params.push(filter.kind) }
  if (filter?.tag) { conditions.push("tags LIKE ?"); params.push(`%"${filter.tag}"%`) }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ")
  sql += " ORDER BY created_at DESC"
  return (registryDb.query(sql).all(...(params as Parameters<typeof registryDb.query>)) as DbRow[]).map(rowToEntry)
}

export function deleteEntry(uri: string) {
  registryDb.prepare("DELETE FROM entries WHERE uri = ?").run(uri)
}
