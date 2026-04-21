/**
 * Preloaded by `bun test` via bunfig.toml. Runs before any test module is imported.
 *
 * Sets a unique per-process temp DB path so tests don't touch the user's real
 * neuron.db and parallel test workers don't collide.
 */
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unlinkSync, existsSync } from "node:fs"

if (!process.env.NEURON_DB_PATH) {
  const path = join(tmpdir(), `neuron-test-${process.pid}-${Date.now()}.db`)
  process.env.NEURON_DB_PATH = path
  // Clean up the temp DB on process exit (best-effort).
  process.on("exit", () => {
    for (const suffix of ["", "-shm", "-wal"]) {
      const p = path + suffix
      try { if (existsSync(p)) unlinkSync(p) } catch { /* ignore */ }
    }
  })
}
