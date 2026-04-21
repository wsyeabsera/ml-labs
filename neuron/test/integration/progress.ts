/**
 * Progress-streaming smoke test. Runs a training that would exceed the
 * default 5-minute per-call timeout without progress-based timeout reset.
 *
 * Not in the default `bun test` lane (it takes minutes). Run explicitly:
 *   bun run test/integration/progress.ts
 */
import { rsTensor } from "../../src/core/mcp_client"

const N = 500
const D = 32
const EPOCHS = 3000

async function main() {
  // Build a tiny dataset and a 1-hidden-layer MLP.
  const inputs: number[] = []
  const targets: number[] = []
  for (let i = 0; i < N; i++) {
    const x: number[] = []
    for (let j = 0; j < D; j++) x.push(Math.sin(i * 0.1 + j * 0.3))
    inputs.push(...x)
    const clsA = x.reduce((a, b) => a + b, 0) > 0 ? 1 : 0
    targets.push(clsA, 1 - clsA)
  }

  const runId = `progress_smoke_${Date.now()}`
  await rsTensor.createTensor(`${runId}_x`, inputs, [N, D])
  await rsTensor.createTensor(`${runId}_y`, targets, [N, 2])
  await rsTensor.initMlp([D, 128, 64, 2], runId, { activation: "relu" })

  let progressCount = 0
  let lastEpoch = 0
  const t0 = Date.now()

  const result = await rsTensor.trainMlp(runId, `${runId}_x`, `${runId}_y`, 0.01, EPOCHS, {
    optimizer: "adamw",
    activation: "relu",
    lr_schedule: "cosine",
    loss: "cross_entropy",
    batch_size: 8,
    onProgress: (p) => {
      progressCount++
      lastEpoch = Math.round(p.progress)
      if (progressCount <= 3 || progressCount % 50 === 0) {
        const elapsedS = Math.round((Date.now() - t0) / 1000)
        console.log(`  progress #${progressCount}: ${p.message ?? `epoch ${p.progress}/${p.total}`} [t=${elapsedS}s]`)
      }
    },
  })

  const elapsedS = Math.round((Date.now() - t0) / 1000)
  console.log(`\n✓ training completed in ${elapsedS}s`)
  console.log(`✓ final loss: ${result.final_loss?.toFixed(6)}`)
  console.log(`✓ progress notifications received: ${progressCount}`)
  console.log(`✓ last reported epoch: ${lastEpoch} / ${EPOCHS}`)

  // Assertions
  const checks: string[] = []
  if (progressCount < 10) checks.push(`expected ≥10 progress notifications, got ${progressCount}`)
  if (lastEpoch < EPOCHS * 0.9) checks.push(`last epoch ${lastEpoch} << ${EPOCHS}`)
  if (result.final_loss === undefined) checks.push("final_loss missing from result")

  if (checks.length) {
    console.error("\n✗ failures:")
    for (const c of checks) console.error("  -", c)
    process.exit(1)
  }
  console.log("\n✓ all checks passed")
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
