import { XCircle, CheckCircle2, AlertTriangle } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import type { ReactNode } from "react"

interface AntiPattern {
  title: string
  symptom: string
  why: ReactNode
  bad: { code: string; lang: string }
  good: { code: string; lang: string }
  takeaway: ReactNode
}

const patterns: AntiPattern[] = [
  // ── 1 ──────────────────────────────────────────────────────────────
  {
    title: "Passing the whole CSV as features",
    symptom: "ML-Labs returns a vague 'shape mismatch' or training never converges.",
    why: (
      <>
        <code>collect</code> takes a single sample's features — a number array of length D, where D
        is your <code>featureShape[0]</code>. Pass the whole CSV (an array of arrays) and the trainer
        either crashes or treats every row as a single Frankenstein feature.
      </>
    ),
    bad: {
      lang: "ts",
      code: `// 768 rows × 8 cols, passed as one feature
mcp__neuron__collect({
  task_id: "pima",
  label: "0",
  features: pimaCsv,   // ← [[6,148,...], [1,85,...], ...]
})`,
    },
    good: {
      lang: "ts",
      code: `// load_csv handles the loop for you
mcp__neuron__load_csv({
  task_id: "pima",
  path: "./pima.csv",
  label_column: "outcome",
})

// OR collect one row at a time
for (const row of pimaCsv) {
  mcp__neuron__collect({
    task_id: "pima",
    label: row.outcome,
    features: [row.preg, row.glucose, ...],  // length 8
  })
}`,
    },
    takeaway: (
      <>For tabular data, <strong>always use <code>load_csv</code></strong>. <code>collect</code> is
      for the rare case where you have one sample at a time and need raw + label control.</>
    ),
  },

  // ── 2 ──────────────────────────────────────────────────────────────
  {
    title: "Calling train in a loop instead of run_sweep",
    symptom: "Iterating across 20 hyperparameter configs takes forever, and the dashboard floods with sequential runs.",
    why: (
      <>
        Every <code>train</code> call boots a sub-agent (or an in-process loop) and awaits completion.
        Sequenced from a script, you get serial behaviour and no winner-selection. <code>run_sweep</code>{" "}
        does the orchestration, parallelism, and winner promotion in one call.
      </>
    ),
    bad: {
      lang: "ts",
      code: `for (const lr of [0.001, 0.005, 0.01]) {
  for (const eps of [500, 1000]) {
    await mcp__neuron__train({
      task_id: "iris",
      lr, epochs: eps,
    })
  }
}
// 6 sequential trainings. No parallel, no winner.`,
    },
    good: {
      lang: "ts",
      code: `mcp__neuron__run_sweep({
  task_id: "iris",
  search: {
    lr: [0.001, 0.005, 0.01],
    epochs: [500, 1000],
  },
  promote_winner: true,
})
// 6 configs, runs in parallel (sub-agents) or
// sequential (in-process), winner promoted automatically.`,
    },
    takeaway: <>For any ≥2 configs, prefer <code>run_sweep</code>. For ≥3 with auto-tuning, prefer <code>auto_train</code>.</>,
  },

  // ── 3 ──────────────────────────────────────────────────────────────
  {
    title: "Chasing accuracy_target without a val split",
    symptom: "auto_train hits 1.0 accuracy on every run. The promoted model is worthless on new data.",
    why: (
      <>
        Without a held-out split, <code>val_accuracy</code> is null. Winner selection falls back to
        training accuracy — which a model with enough capacity can drive to 1.0 by memorising. The
        verdict says &ldquo;completed,&rdquo; the dashboard celebrates, your real-world predictions are
        garbage.
      </>
    ),
    bad: {
      lang: "ts",
      code: `// test_size=0 means everything is in the train split
mcp__neuron__load_csv({
  task_id: "iris",
  path: "./iris.csv",
  label_column: "species",
  test_size: 0,
})

mcp__neuron__auto_train({
  task_id: "iris",
  accuracy_target: 0.95,
})
// "completed: accuracy=1.0 on run 5" — but val_accuracy is null.`,
    },
    good: {
      lang: "ts",
      code: `mcp__neuron__load_csv({
  task_id: "iris",
  path: "./iris.csv",
  label_column: "species",
  test_size: 0.2,        // ← reserve 20%
  stratify: "auto",       // ← keep class proportions
})

mcp__neuron__auto_train({ task_id: "iris" })
// Now winner selection uses val_accuracy.
// scoreClassification penalises overfitting (gap > 0.15).`,
    },
    takeaway: (
      <>
        <strong>Always reserve a val split.</strong> 20% is conventional. v1.10.0 fixed both train
        paths so val_accuracy is populated consistently — but you still need to <em>load</em> the data
        with a split for it to work.
      </>
    ),
  },

  // ── 4 ──────────────────────────────────────────────────────────────
  {
    title: "Ignoring imbalance_ratio",
    symptom: "Model predicts the majority class for everything. Per-class accuracy: 100% / 0%.",
    why: (
      <>
        With <code>imbalance_ratio &gt; 5</code>, the easy way to minimise loss is to always predict
        the majority class. <code>data_audit</code> warns about this; ignoring the warning costs you
        the minority class entirely. <code>class_weights: "balanced"</code> oversamples minorities
        so they contribute equally to the loss.
      </>
    ),
    bad: {
      lang: "ts",
      code: `// 950 normals, 50 frauds — imbalance_ratio = 19
mcp__neuron__load_csv({ task_id: "fraud", ... })
mcp__neuron__train({ task_id: "fraud" })

// Result:
//   accuracy: 0.95   ← suspicious
//   per_class:
//     normal:  1.00
//     fraud:   0.00   ← model never predicts fraud
//   confusion: [[950,0],[50,0]]`,
    },
    good: {
      lang: "ts",
      code: `// data_audit flags this; auto_train picks balanced automatically
mcp__neuron__data_audit({ task_id: "fraud" })
// → "imbalance_ratio: 19, recommend class_weights: balanced"

mcp__neuron__train({
  task_id: "fraud",
  class_weights: "balanced",   // ← oversamples frauds
})

// Result:
//   accuracy: 0.86   ← lower but real
//   per_class:
//     normal:  0.89
//     fraud:   0.74   ← actually catches frauds`,
    },
    takeaway: <>If <code>imbalance_ratio &gt; 3</code>, use <code>class_weights: "balanced"</code>. <code>auto_train</code> does this automatically when it sees the imbalance.</>,
  },

  // ── 5 ──────────────────────────────────────────────────────────────
  {
    title: "Mistaking train accuracy for val accuracy",
    symptom: "You report 'we got 98% accuracy' to your team. Production accuracy on real users is 65%.",
    why: (
      <>
        ML-Labs returns both <code>accuracy</code> (on training data) and <code>val_accuracy</code>{" "}
        (on the held-out set). They're different. Quoting the first is the most common silent
        failure mode in junior ML projects — and was the v1.10.0 bug-hunt issue: SWA + AdamW could
        memorise the training set, getting 1.0 train acc with terrible val acc.
      </>
    ),
    bad: {
      lang: "ts",
      code: `const result = await mcp__neuron__train({ task_id: "churn" })
console.log("Done!", result.accuracy)
// 0.984 — you're proud, you ship it.
// Real users: 0.65.`,
    },
    good: {
      lang: "ts",
      code: `const result = await mcp__neuron__train({ task_id: "churn" })
console.log("Train acc:", result.accuracy)
console.log("Val acc:",   result.val_accuracy)
// Train: 0.984
// Val:   0.71  ← the real number

// Even better: cross-validate before promoting
const cv = await mcp__neuron__cv_train({ task_id: "churn", k: 5 })
console.log(\`CV: \${cv.mean_accuracy} ± \${cv.std_accuracy}\`)
// CV: 0.69 ± 0.04`,
    },
    takeaway: (
      <>
        <strong>Always quote val_accuracy.</strong> <code>auto_train</code>'s scoreClassification
        already prefers it. For high-stakes use, run <code>cv_train(k=5)</code> and quote{" "}
        <code>mean_accuracy ± std_accuracy</code> — that's the truthful number.
      </>
    ),
  },

  // ── 6 ──────────────────────────────────────────────────────────────
  {
    title: "Not calibrating confidence scores",
    symptom: "You build a feature that flags 'low confidence' predictions for human review. The model is overconfident — almost every prediction is >0.9, missing the actual hard cases.",
    why: (
      <>
        Modern MLPs are systematically over-confident. A model with 90% top-1 accuracy might output
        confidence 0.99 most of the time. Without calibration, your &ldquo;confidence threshold&rdquo;
        is meaningless — a 0.7 cutoff catches almost nothing.
      </>
    ),
    bad: {
      lang: "ts",
      code: `// Train, register, predict
mcp__neuron__train({ task_id: "support" })

const pred = mcp__neuron__predict({ task_id: "support", features: [...] })
// pred.confidence = 0.987 — but the model is wrong 15% of the time.
// Threshold @ 0.7 flags almost nothing for review.`,
    },
    good: {
      lang: "ts",
      code: `mcp__neuron__train({ task_id: "support" })

// Calibrate AFTER training
mcp__neuron__calibrate({ run_id: 12 })
// → temperature: 1.34, ECE: 0.062 → 0.018

// Now confidences match empirical accuracy
const pred = mcp__neuron__predict({ task_id: "support", features: [...] })
// pred.confidence = 0.78 — meaningful.
// Threshold @ 0.7 catches the actually-uncertain cases.`,
    },
    takeaway: <>For any flow that uses confidence (thresholding, escalation, ranking), call <code>calibrate</code>. <code>auto_train</code> does this automatically on the promoted run.</>,
  },

  // ── 7 ──────────────────────────────────────────────────────────────
  {
    title: "Training on Fashion-MNIST without dry_run",
    symptom: "Your laptop OOM-kills Bun mid-training. SQLite WAL files are huge, the auto_runs row says 'running' forever.",
    why: (
      <>
        60k × 784 input cells = ~47M, well into the &ldquo;refuse&rdquo; memory band. Without
        v1.7.1's streaming fix, peak heap hits ~3GB. Even after the fix, sub-agent sweeps × 3 puts
        you in OOM territory on 8GB machines.
      </>
    ),
    bad: {
      lang: "ts",
      code: `mcp__neuron__load_csv({ task_id: "fashion", path: "./fashion.csv", ... })
mcp__neuron__auto_train({
  task_id: "fashion",
  accuracy_target: 0.85,
})
// Crashes on 8GB laptop.`,
    },
    good: {
      lang: "ts",
      code: `// 1. Preview first
const preview = await mcp__neuron__auto_train({
  task_id: "fashion",
  dry_run: true,
})
// preview.budget.level = "heavy" or "refuse"

// 2. If refuse, decide:
if (preview.would_refuse) {
  // Subset for iteration
  await mcp__neuron__create_task({ id: "fashion-10k", ... })
  // ... shuf -n 10000 your.csv ...
  // iterate on the subset, then one final train on full data
}

// 3. If heavy, set budget_s above the high estimate
await mcp__neuron__auto_train({
  task_id: "fashion",
  budget_s: 1800,   // upper end of estimate
})`,
    },
    takeaway: (
      <>
        <strong>For anything bigger than tabular data, dry_run first.</strong> The memory budget will
        tell you the level + give an ETA. If it's refuse-level, subset before iterating. See the
        <a href="/memory-budget" className="text-orange-neon hover:underline"> Memory Budget</a> page.
      </>
    ),
  },
]

export function AntiPatterns() {
  return (
    <div>
      <PageHeader
        eyebrow="The right way and the wrong way"
        accent="orange"
        title={<><span className="gradient-text">Anti-patterns</span>.</>}
        lede="Common ways to misuse ML-Labs, with the broken code, the fixed code, and a one-line takeaway. The first six are silent failures — they don't crash, they just produce bad models. The seventh is loud (it OOMs your laptop), but predictable."
      />

      <div className="space-y-12">
        {patterns.map((p, i) => (
          <Section key={p.title} eyebrow={`Anti-pattern #${i + 1}`} title={p.title}>
            <div className="lab-panel p-5 mb-6 border-orange-neon/30 border">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-neon shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-orange-neon mb-1">Symptom</div>
                  <p className="text-sm text-lab-text/85">{p.symptom}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 mt-4">
                <div className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-widest text-purple-neon mb-1">Why</div>
                  <p className="text-sm text-lab-text/85">{p.why}</p>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-orange-neon" />
                  <span className="text-sm font-semibold text-orange-neon">Don't</span>
                </div>
                <CodeBlock lang={p.bad.lang} code={p.bad.code} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-green-neon" />
                  <span className="text-sm font-semibold text-green-neon">Do</span>
                </div>
                <CodeBlock lang={p.good.lang} code={p.good.code} />
              </div>
            </div>

            <Callout kind="learn" title="Takeaway">
              {p.takeaway}
            </Callout>
          </Section>
        ))}
      </div>
    </div>
  )
}
