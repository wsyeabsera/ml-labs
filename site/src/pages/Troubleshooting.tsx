import { useState, useMemo } from "react"
import { Search, AlertTriangle } from "lucide-react"
import { motion } from "framer-motion"
import { PageHeader } from "../components/PageHeader"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"

interface FAQ {
  symptom: string
  cause: string
  fix: string | JSX.Element
  category: string
  tags: string[]
}

const faqs: FAQ[] = [
  // ── Setup / install ────────────────────────────────────────────────
  {
    category: "Setup",
    tags: ["install", "claude-code"],
    symptom: "Claude Code doesn't see the Neuron tools.",
    cause: "Either .mcp.json is missing/malformed, or Claude Code was started before init wrote it.",
    fix: (
      <>
        Open the project root in Claude Code (not a parent directory). Confirm <code>.mcp.json</code>{" "}
        exists. If it does and tools still don't appear, restart Claude Code (menu → restart MCP
        servers, or quit and reopen the project).
      </>
    ),
  },
  {
    category: "Setup",
    tags: ["bun", "install"],
    symptom: "ml-labs: command not found",
    cause: "~/.local/bin isn't on PATH, or the install script didn't write the wrapper.",
    fix: (
      <>
        <CodeBlock
          lang="bash"
          code={`# Check the wrapper exists
ls ~/.local/bin/ml-labs

# Check it's on PATH
echo $PATH | tr ':' '\\n' | grep '\\.local/bin'

# If missing, reload your shell or add manually
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc`}
        />
      </>
    ),
  },
  {
    category: "Setup",
    tags: ["mcp", "rs-tensor"],
    symptom: "Neuron tools appear but every call fails with 'rs-tensor not connected'",
    cause: "rs-tensor child process didn't start (missing binary, cargo not installed, or RS_TENSOR_MCP_URL pointing at a dead URL).",
    fix: (
      <>
        Run <code>ml-labs build</code> to (re)build the rs-tensor binary, then{" "}
        <code>ml-labs health</code> to check connectivity. If you set{" "}
        <code>RS_TENSOR_MCP_URL</code>, unset it to use the local binary.
      </>
    ),
  },

  // ── Data loading ───────────────────────────────────────────────────
  {
    category: "Data",
    tags: ["load_csv", "memory"],
    symptom: "load_csv crashes / OOM with 'JS heap out of memory'",
    cause: "File >500MB hits the safety cap, or load_csv pre-v1.7.1 used to materialise huge arrays.",
    fix: (
      <>
        Update to v1.7.1+ and pass <code>max_bytes</code> if you really need to load a file larger
        than 500MB. Better: subset upstream — head -n 50000 your.csv &gt; subset.csv.
      </>
    ),
  },
  {
    category: "Data",
    tags: ["load_csv", "labels"],
    symptom: "load_csv: 'unknown label column'",
    cause: "label_column doesn't match a header in the CSV (case-sensitive).",
    fix: (
      <>
        Check the exact header with <code>head -1 your.csv</code>. Pass the matching string. If the
        CSV has no header, set <code>has_header: false</code> and use the column name like{" "}
        <code>col_3</code>.
      </>
    ),
  },
  {
    category: "Data",
    tags: ["load_csv", "split"],
    symptom: "Test split is empty after load_csv",
    cause: "test_size = 0 (default in some old templates) puts everything in train.",
    fix: <>Pass <code>test_size: 0.2</code> for a 20% stratified held-out. auto_train without a test split reports training accuracy as the winner — not honest. Always reserve a split.</>,
  },
  {
    category: "Data",
    tags: ["preflight"],
    symptom: "data_audit / preflight returns 'not_ready'",
    cause: "Common: too few samples (<10 per class), only one class, mismatched feature shape.",
    fix: <>Read <code>warnings[]</code> in the output. Most actionable: collect more samples for the weakest class until preflight returns 'ready'.</>,
  },

  // ── Training ───────────────────────────────────────────────────────
  {
    category: "Training",
    tags: ["loss", "nan"],
    symptom: "Loss is NaN after epoch 1.",
    cause: "lr too high → gradients explode → weights become Infinity → softmax becomes NaN.",
    fix: (
      <>
        Try in this order:
        <ol className="list-decimal list-inside mt-2 space-y-0.5">
          <li>Cut <code>lr</code> by 10× (e.g. 0.05 → 0.005)</li>
          <li>Add <code>grad_clip: 1.0</code></li>
          <li>Add <code>lr_schedule: "linear_warmup", warmup_epochs: 10</code></li>
          <li>Verify your features aren't extreme — <code>inspect_data</code> flags scale issues</li>
        </ol>
      </>
    ),
  },
  {
    category: "Training",
    tags: ["loss", "plateau"],
    symptom: "Loss is stuck at the same value forever",
    cause: "Either lr too low, dead ReLUs (try leaky_relu), or all-zero gradient (label_smoothing entropy floor).",
    fix: (
      <>
        Check <code>get_training_curves</code> — if convergence_epoch is very small, lr is too low
        OR you've hit the label_smoothing entropy floor (loss ≈ 0.5 with label_smoothing=0.1, K=10
        is normal). Try doubling lr; switch activation to leaky_relu if loss really is stuck early.
      </>
    ),
  },
  {
    category: "Training",
    tags: ["accuracy", "overfit"],
    symptom: "Train accuracy 0.99 but val accuracy 0.65",
    cause: "Classic overfitting. Model memorised the training set.",
    fix: (
      <>
        Add regularisation:
        <ol className="list-decimal list-inside mt-2 space-y-0.5">
          <li><code>weight_decay: 1e-4</code> (then bump to 1e-3 if needed)</li>
          <li><code>label_smoothing: 0.1</code></li>
          <li>Smaller <code>head_arch</code> (fewer/narrower hidden layers)</li>
          <li><code>swa: true</code></li>
          <li>More training data — see <code>suggest_samples</code></li>
        </ol>
      </>
    ),
  },
  {
    category: "Training",
    tags: ["accuracy", "underfit"],
    symptom: "Both train and val accuracy are stuck at 0.5 (or 1/K)",
    cause: "Model never learned — random-baseline accuracy.",
    fix: (
      <>
        Check the loss curve. If it never moved: bigger lr, switch to AdamW, deeper arch. If loss
        decreased but accuracy didn't: cross_entropy with the wrong target encoding (raise an issue
        if this happens with default ML-Labs settings).
      </>
    ),
  },
  {
    category: "Training",
    tags: ["accuracy", "predict"],
    symptom: "Model predicts the same class for everything.",
    cause: "Severe class imbalance + no balancing, OR the output head is collapsed.",
    fix: <>Check <code>imbalance_ratio</code>: if &gt; 5, retrain with <code>class_weights: "balanced"</code>. If ratio is fine, your training likely has a learning rate / init issue — try <code>auto_train</code> defaults instead of manual.</>,
  },
  {
    category: "Training",
    tags: ["epochs"],
    symptom: "Training takes forever — N=1000 D=10 should not take 2 hours",
    cause: "Either epochs is set absurdly high (e.g. 10000), the head_arch is huge, or rs-tensor's RS_TENSOR_TIMEOUT_MS is masking a frozen call.",
    fix: <>Check <code>get_training_curves</code> — if <code>still_improving</code> is false, set <code>early_stop_patience</code> low (e.g. 30) and re-train. Keep <code>head_arch</code> proportional to data: avoid hidden &gt; 256 unless D is huge.</>,
  },
  {
    category: "Training",
    tags: ["sweep", "memory"],
    symptom: "Sweep crashes mid-wave with OOM on a heavy dataset",
    cause: "Pre-v1.8.1 sub-agent default. Each sub-agent loads the full input tensor (~1GB on Fashion-MNIST), times 3 = 3GB extra.",
    fix: <>Update to v1.8.1+. Or set <code>NEURON_SWEEP_MODE=sequential</code> to opt out of parallel sub-agents. The auto_train memory budget will pick this automatically for heavy workloads.</>,
  },

  // ── auto_train specific ────────────────────────────────────────────
  {
    category: "auto_train",
    tags: ["budget"],
    symptom: "auto_train returns 'budget_exceeded' before any wave completes",
    cause: "budget_s too low for the workload. Default 180s is too tight for anything Fashion-MNIST-sized.",
    fix: <>Run <code>auto_train({"{"} dry_run: true {"}"})</code> first to see the wall-clock estimate, then set budget_s above the high end (eg 1200 for an estimated [180, 900]).</>,
  },
  {
    category: "auto_train",
    tags: ["force", "memory"],
    symptom: "auto_train returns 'data_issue' with 'workload too heavy — pass force: true to override'",
    cause: "Memory budget says this is refuse-level (input cells ≥ 60M). The guardrail is doing its job.",
    fix: <>Either subset your data (recommended), reduce D via featurize, or pass <code>force: true</code> if you have 16+ GB and accept the risk. See the <a href="/memory-budget" className="text-orange-neon hover:underline">Memory Budget</a> page.</>,
  },
  {
    category: "auto_train",
    tags: ["winner", "overfit"],
    symptom: "auto_train picked a memoriser as winner (acc 1.0, val 0.6)",
    cause: "Pre-v1.10.0 — sub-agent sweeps didn't populate val_accuracy, so winner-selection fell back to training accuracy.",
    fix: <>Update to v1.10.0+. Both the MCP and HTTP train paths now run held-out evaluation. The overfit penalty in scoreClassification ensures honest runs win.</>,
  },
  {
    category: "auto_train",
    tags: ["status", "stuck"],
    symptom: "Auto-run rows show 'running' forever even though no process is alive",
    cause: "Coordinator died (SIGKILL, laptop slept, terminal closed) without writing a terminal status.",
    fix: <>v1.10.0+ has a startup reaper that clears stale rows on next server start. Manual fix: <code>cancel_auto_train(auto_run_id)</code>. Or directly: <code>UPDATE auto_runs SET status = 'cancelled', finished_at = '...' WHERE id = X</code> in sqlite3.</>,
  },
  {
    category: "auto_train",
    tags: ["configs_tried"],
    symptom: "Verdict says '0 configs tried' but the dashboard shows runs were started",
    cause: "Pre-v1.10.0 — configs_tried counted only sub-agent results that returned to the orchestrator. Aborted sweeps lost the count.",
    fix: <>Update to v1.10.0+. configs_tried now uses max(completed_results, db_count) so the count is honest even on aborted waves.</>,
  },

  // ── Predict / inference ────────────────────────────────────────────
  {
    category: "Predict",
    tags: ["mlp-not-found"],
    symptom: "predict fails with 'MLP iris not found' even though I trained one",
    cause: "Server restarted and lazy-restore failed (e.g. weights JSON malformed, rs-tensor process replaced).",
    fix: <>Check <code>list_runs(task_id)</code> — if a completed run exists with <code>weights</code> populated, lazy-restore should fire on next predict. If it doesn't, manually <code>register_model</code> on a known-good run.</>,
  },
  {
    category: "Predict",
    tags: ["confidence"],
    symptom: "Predict returns confidences that don't match reality (0.99 confidence on 60% accuracy)",
    cause: "Uncalibrated softmax. Modern MLPs are systematically over-confident.",
    fix: <>Run <code>calibrate(run_id)</code> to fit a temperature on the val split. ECE drops; argmax doesn't change. See <a href="/validation" className="text-pink-neon hover:underline">Validation</a>.</>,
  },
  {
    category: "Predict",
    tags: ["features", "shape"],
    symptom: "predict says 'shape mismatch — expected D=4 got D=10'",
    cause: "Features array isn't D-long or you swapped tasks.",
    fix: <>Check <code>get_task(task_id).feature_shape</code> — that's what the model expects. If you changed the data shape since training, the model is stale; retrain.</>,
  },

  // ── Dashboard / TUI ────────────────────────────────────────────────
  {
    category: "Dashboard",
    tags: ["dashboard", "stale"],
    symptom: "ml-labs docs / dashboard shows old version after update",
    cause: "Pre-v1.10.2: dist cache wasn't invalidated by ml-labs update.",
    fix: <>Update to v1.10.2+. ml-labs update now clears site/dist and dashboard/dist; ml-labs docs auto-rebuilds when sources are newer.</>,
  },
  {
    category: "Dashboard",
    tags: ["port"],
    symptom: "ml-labs dashboard says 'port 2626 in use'",
    cause: "Another dashboard instance, or some other service, is bound there.",
    fix: <>Set <code>NEURON_API_PORT=8080</code> (or any free port) and re-run. Or kill the conflicting process: <code>lsof -ti tcp:2626 | xargs kill -9</code>.</>,
  },

  // ── DB / state ─────────────────────────────────────────────────────
  {
    category: "Database",
    tags: ["sqlite", "lock"],
    symptom: "'database is locked' error",
    cause: "WAL mode handles most cases but a non-WAL SQLite client opened the DB exclusively, OR something has a transaction open and the OS is preempting.",
    fix: <>Make sure you're using <code>sqlite3 --readonly</code> or close other connections. Check <code>fuser data/neuron.db</code> for who's holding it. If it persists, the WAL files (-shm, -wal) may be from a previous session — if no neuron-mcp is running, deleting them is safe.</>,
  },
  {
    category: "Database",
    tags: ["corrupt", "recovery"],
    symptom: "Server crashes with 'malformed database disk image'",
    cause: "SIGKILL during a write, disk full, or filesystem error.",
    fix: (
      <>
        <CodeBlock
          lang="bash"
          code={`# 1. Try recovery
sqlite3 data/neuron.db ".recover" | sqlite3 data/recovered.db

# 2. If that fails, dump what's salvageable
sqlite3 data/neuron.db ".dump" > dump.sql

# 3. As a last resort, restore from a backup or start fresh
mv data/neuron.db data/neuron.db.broken
# then re-run create_task + load_csv`}
        />
      </>
    ),
  },

  // ── Misc / edge ────────────────────────────────────────────────────
  {
    category: "Misc",
    tags: ["adapter", "import"],
    symptom: "import_model: 'adapter hash mismatch — featurize differs'",
    cause: "Project A's neuron.config.ts featurize is byte-different from project B's. Same hash means same featurize behaviour.",
    fix: <>Either align the two featurize functions (copy the file), or pass <code>force: true</code> to import_model — but only if you've manually verified the featurize behaviour is the same.</>,
  },
  {
    category: "Misc",
    tags: ["llm", "tokens"],
    symptom: "llm_generate output is gibberish or all the same token",
    cause: "Naive whitespace tokenization dropped most of your prompt; or temperature too high; or a low-quality quantization.",
    fix: <>Use <code>token_ids</code> with a real BPE tokenizer rather than the prompt string path. Lower temperature to 0.5-0.7. Try a Q5_K_M or Q8 quantization instead of Q4_0 for better quality.</>,
  },
  {
    category: "Misc",
    tags: ["claude", "sampling"],
    symptom: "suggest_hyperparams returns the same heuristic config every time",
    cause: "MCP Sampling isn't available. Falling back to deterministic rules.",
    fix: <>This is fine — just means Claude isn't being asked. Check the <code>source</code> field in the output. To force Sampling, ensure you're running through Claude Code with API access. See <a href="/sampling-fallback" className="text-purple-neon hover:underline">Sampling Fallback</a>.</>,
  },
]

const categories = ["All", ...Array.from(new Set(faqs.map((f) => f.category)))]

export function Troubleshooting() {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("All")

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return faqs.filter((f) => {
      if (cat !== "All" && f.category !== cat) return false
      if (!query) return true
      return (
        f.symptom.toLowerCase().includes(query) ||
        f.cause.toLowerCase().includes(query) ||
        f.tags.some((t) => t.includes(query))
      )
    })
  }, [q, cat])

  return (
    <div>
      <PageHeader
        eyebrow="Symptom → cause → fix"
        accent="orange"
        title={<><span className="gradient-text">Troubleshooting</span> & FAQ.</>}
        lede="The Cmd+F page. Search by symptom or scroll the categories. Every entry follows the same shape: what you'll see, why it's happening, what to do about it."
      />

      <div className="lab-panel p-4 mb-8 sticky top-4 z-10 backdrop-blur-md">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-lab-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by symptom, cause, or tag..."
              className="w-full pl-10 pr-4 py-2.5 bg-lab-bg border border-lab-border rounded-lg text-sm text-lab-heading placeholder:text-lab-muted focus:outline-none focus:border-orange-neon/60 focus:ring-1 focus:ring-orange-neon/30"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  cat === c
                    ? "bg-orange-neon/15 text-orange-neon border border-orange-neon/40"
                    : "border border-lab-border text-lab-text/70 hover:text-lab-heading hover:border-lab-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-lab-muted mt-3">
          Showing <span className="text-lab-heading font-semibold">{filtered.length}</span> of {faqs.length}
        </div>
      </div>

      {filtered.length === 0 && (
        <Callout kind="note">
          Nothing matches. Try a different search or look in the{" "}
          <a href="/glossary" className="text-cyan-neon hover:underline">Glossary</a>.
        </Callout>
      )}

      <div className="space-y-4">
        {filtered.map((f, i) => (
          <motion.div
            key={f.symptom}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.2) }}
            className="lab-panel p-5"
          >
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-orange-neon shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[10px] font-mono uppercase tracking-widest text-lab-muted mb-1">
                  {f.category}
                </div>
                <div className="text-lab-heading font-semibold mb-2">{f.symptom}</div>
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {f.tags.map((t) => (
                    <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-lab-border text-lab-muted">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 ml-8">
              <div className="text-sm">
                <span className="text-purple-neon font-mono text-[11px] uppercase tracking-widest">Cause</span>
                <p className="text-lab-text/80 mt-0.5">{f.cause}</p>
              </div>
              <div className="text-sm">
                <span className="text-green-neon font-mono text-[11px] uppercase tracking-widest">Fix</span>
                <div className="text-lab-text/80 mt-0.5">{f.fix}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <Callout kind="tip" title="Don't see your problem?">
        File an issue at the{" "}
        <a href="https://github.com/wsyeabsera/ml-labs/issues" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">
          GitHub repo
        </a>{" "}
        with: ML-Labs version (<code>ml-labs --version</code>), ml-labs status output, and the command
        you ran. We'll either fix it or add it here.
      </Callout>
    </div>
  )
}
