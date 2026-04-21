import { BENCHES, FULL_SUITE } from "./configs"
import { runBench } from "./harness"
import { compareToBaseline, loadBaseline, writeBaseline } from "./compare"
import type { BenchResult } from "./types"

async function main() {
  const args = process.argv.slice(2)
  const bless = args.includes("--bless")
  const filtered = args.filter((a) => !a.startsWith("--"))
  const names = filtered.length > 0 ? filtered : FULL_SUITE

  const baseline = loadBaseline()
  const results: BenchResult[] = []
  let regressCount = 0

  const SEED = 42
  const NEURON_VERSION = "0.13.0"

  console.log(`\n=== ml-labs benchmark harness ===`)
  console.log(`Running ${names.length} bench(es): ${names.join(", ")}`)
  console.log(`Mode: deterministic (seed=${SEED}, planner=rules, sweep=sequential)`)
  console.log(`Baseline: ${baseline ? `loaded (${baseline.generated_at})` : "none — first run"}`)
  console.log("")

  for (const name of names) {
    const config = BENCHES[name]
    if (!config) {
      console.error(`Unknown bench: "${name}". Available: ${FULL_SUITE.join(", ")}`)
      process.exit(2)
    }

    process.stdout.write(`  [${name}]  `)
    const t0 = Date.now()
    try {
      const r = await runBench(config, SEED)
      results.push(r)
      const dt = Math.round((Date.now() - t0) / 1000)
      const verdict = compareToBaseline(r, baseline)
      if (verdict.status === "regress") regressCount++

      const badge =
        verdict.status === "pass" ? "✓" :
        verdict.status === "regress" || verdict.status === "hash_mismatch" ? "✗" :
        verdict.status === "no_baseline" ? "·" : "?"

      console.log(`${badge}  ${r.metric_name}=${r.metric_value?.toFixed(3) ?? "n/a"}  waves=${r.waves_used}  configs=${r.configs_tried}  t=${dt}s  ${verdict.message}`)
    } catch (e) {
      console.log(`✗  error: ${e instanceof Error ? e.message : String(e)}`)
      regressCount++
    }
  }

  if (bless) {
    writeBaseline(results, NEURON_VERSION)
    console.log(`\n✓ baseline written (${results.length} entries)`)
  } else if (!baseline) {
    console.log(`\n→ no baseline found. Re-run with --bless to write one.`)
  }

  if (regressCount > 0 && !bless) {
    console.error(`\n✗ ${regressCount} bench(es) regressed or errored`)
    process.exit(1)
  }

  console.log(`\n✓ done (${results.length}/${names.length} completed)`)
}

main()
  .then(() => {
    // rs-tensor child process stdio keeps the event loop alive; force-exit.
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
