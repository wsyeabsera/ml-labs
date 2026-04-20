import { PageHeader } from "../components/PageHeader"
import { motion } from "framer-motion"

interface Release {
  version: string
  date: string
  tag?: string
  tagColor?: string
  items: { label: string; desc: string }[]
}

const releases: Release[] = [
  {
    version: "0.2.1",
    date: "2026-04-20",
    tag: "latest",
    tagColor: "chip-green",
    items: [
      { label: "Train/test split", desc: "load_csv gains test_size (0–0.5) for stratified splits. train only uses the train split; evaluate reports both accuracies." },
      { label: "Z-score normalization", desc: "create_task normalize=true. Stats computed from training data, stored per run, applied transparently at predict time." },
      { label: "Regression tasks", desc: "kind=\"regression\": single K=1 output, min-max scaled targets, MAE/RMSE/R² metrics, value returned from predict." },
      { label: "Class weights", desc: "train class_weights=\"balanced\" oversamples minority classes to equal the majority count." },
      { label: "inspect_data (#31)", desc: "Dataset health check: per-feature stats, class distribution, imbalance ratio, split counts, constant-feature and scale warnings." },
      { label: "get_training_curves (#32)", desc: "Loss history with convergence epoch, still_improving flag, and overfitting gap (train vs val accuracy)." },
      { label: "model_stats (#33)", desc: "Confidence distribution histogram, per-class accuracy + mean confidence, low_confidence_count on train/test/all splits." },
      { label: "batch_predict (#34)", desc: "Run inference over a CSV file with optional accuracy scoring when a label column is provided." },
      { label: "Bundled examples", desc: "ml-labs init copies examples/iris.csv (150 rows) and examples/housing.csv (71 rows, regression) into new projects." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-04-20",
    items: [
      { label: "ml-labs CLI", desc: "init, update, docs commands. curl | bash installer writes a shell wrapper to ~/.local/bin/ml-labs." },
      { label: "install.sh", desc: "One-liner installer: clones ~/.ml-labs, installs deps, builds docs, patches PATH." },
      { label: "Docs site", desc: "React + Vite docs site at site/. 9 pages: Install, CLI Reference, Changelog + 6 existing." },
      { label: "Monorepo cleanup", desc: "Removed faceread (v1/v2) and ViT experiments. Root package.json workspace. git initialized." },
      { label: "Cross-session predict", desc: "Weights restore lazily from SQLite into rs-tensor on first predict after server restart." },
      { label: "suggest_samples (#30)", desc: "Active learning: batch-evaluate all samples, surface uncertain/misclassified rows, emit data-collection recommendations." },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-04-19",
    items: [
      { label: "auto_train", desc: "Coordinator sub-agent (40 turns, 11-tool allowlist): preflight → suggest → sweep → evaluate → diagnose → promote." },
      { label: "get_auto_status", desc: "Live decision log cross-process via SQLite WAL." },
      { label: "wave sweeps", desc: "run_sweep gains wave_size — stages configs into sequential batches." },
      { label: "auto_runs table", desc: "Persists coordinator invocations with decision_log JSON array." },
      { label: "/neuron-auto command", desc: "New slash command for full auto-train pipeline." },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-04-19",
    items: [
      { label: "run_sweep", desc: "Parallel hyperparam grid search via Agent SDK sub-agents. concurrency + promote_winner." },
      { label: "Model registry", desc: "publish_model, import_model, load_model, list_registry. URI: neuron://local/<name>@<version>." },
      { label: "Claude Code skills", desc: "8 slash commands + SKILL.md under .claude/." },
      { label: "DB: WAL mode", desc: "run_progress, owner_pid, source_uri columns added to runs." },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-04-19",
    items: [
      { label: "Ink TUI", desc: "5-screen terminal dashboard: Dashboard, Dataset, Train, Runs, Predict." },
      { label: "Batch loaders", desc: "load_csv, load_json, load_images." },
      { label: "get_run_status", desc: "Live training progress cross-process via DB." },
      { label: "Iris verified", desc: "98.7% accuracy on iris dataset." },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-04-19",
    items: [
      { label: "16-tool MCP server", desc: "SQLite persistence, adapter pattern (neuron.config.ts), rs-tensor integration." },
      { label: "XOR verified", desc: "100% accuracy on XOR problem." },
    ],
  },
]

const tagColors: Record<string, string> = {
  "chip-green": "bg-green-neon/10 text-green-neon border border-green-neon/30",
  "chip-cyan": "bg-cyan-neon/10 text-cyan-neon border border-cyan-neon/30",
}

export function Changelog() {
  return (
    <div>
      <PageHeader
        eyebrow="Version history"
        accent="pink"
        title={<>What's <span className="gradient-text">changed.</span></>}
        lede="ML-Labs ships fast. Every phase adds tools, fixes bugs, or makes the install story better. Latest is always at the top."
      />

      <div className="space-y-10">
        {releases.map((r, i) => (
          <motion.div
            key={r.version}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.05 }}
            className="lab-panel p-7"
          >
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-xl font-bold font-mono text-lab-heading">v{r.version}</h2>
              {r.tag && (
                <span className={`text-xs font-mono px-2 py-0.5 rounded-md ${tagColors[r.tagColor ?? "chip-green"]}`}>
                  {r.tag}
                </span>
              )}
              <span className="text-sm text-lab-muted ml-auto font-mono">{r.date}</span>
            </div>
            <ul className="space-y-3">
              {r.items.map((item) => (
                <li key={item.label} className="flex gap-3 text-sm">
                  <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-cyan-neon/60 mt-[7px]" />
                  <span>
                    <strong className="text-lab-heading">{item.label}</strong>
                    {" — "}
                    <span className="text-lab-text/75">{item.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
