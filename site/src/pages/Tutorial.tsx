import { Database, Workflow, Trophy, ShieldCheck } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { Timeline } from "../components/Timeline"
import { InfoCard } from "../components/InfoCard"

export function Tutorial() {
  return (
    <div>
      <PageHeader
        eyebrow="20 minutes, end to end"
        accent="cyan"
        title={<>Build a <span className="gradient-text">churn classifier</span>.</>}
        lede="A complete walkthrough: load a real dataset (Pima diabetes — predict whether a patient develops diabetes within five years), train it, calibrate it, predict, then come back a month later and check for drift. By the end, you'll have shipped a model and watched it age."
      />

      <Section eyebrow="The dataset" title="Pima diabetes.">
        <p>
          The Pima Indians Diabetes dataset has been a standard ML benchmark for decades. 768 patients,
          8 features (age, glucose, BMI, blood pressure, etc.), binary outcome (developed diabetes within
          5 years: yes/no). Mild class imbalance (~2:1), real noise, real variance — a good first project.
        </p>
        <Callout kind="learn" title="Why this dataset">
          It's small enough to train on a laptop in seconds. The class imbalance forces you to think
          about <code>class_weights</code>. The features are heterogeneous (different scales) so you'll
          see normalisation in action. And 768 samples is enough to make k-fold cross-validation
          meaningful without being slow.
        </Callout>
      </Section>

      <Section eyebrow="Step 0" title="Set up the project.">
        <CodeBlock
          lang="bash"
          title="terminal"
          code={`# Create a new ML-Labs project
ml-labs init pima-diabetes
cd pima-diabetes

# Download the CSV
curl -o pima.csv https://raw.githubusercontent.com/jbrownlee/Datasets/master/pima-indians-diabetes.data.csv

# Add a header (the file ships without one)
echo "pregnancies,glucose,blood_pressure,skin_thickness,insulin,bmi,pedigree,age,outcome" > pima_with_header.csv
cat pima.csv >> pima_with_header.csv
mv pima_with_header.csv pima.csv

# Open in Claude Code (Cursor / VS Code with Claude / Claude Desktop)
# You should see Neuron tools appear in the MCP panel.`}
        />
      </Section>

      <Section eyebrow="Step 1" title="Create the task.">
        <p>
          Tell ML-Labs what kind of problem this is. Binary classification, 8 features, normalize
          (because feature scales differ wildly — age vs blood pressure vs pedigree).
        </p>
        <CodeBlock
          lang="ts"
          title="In Claude Code"
          code={`> Create a classification task called "pima" with 8 features and normalization.

# Claude calls:
mcp__neuron__create_task({
  id: "pima",
  kind: "classification",
  feature_shape: [8],
  normalize: true,
})`}
        />
      </Section>

      <Section eyebrow="Step 2" title="Load the data.">
        <p>
          Use the <code>/neuron-load</code> slash command (or just say it in English). We want a 20%
          test split, stratified so both splits keep the ~2:1 class ratio.
        </p>
        <CodeBlock
          lang="ts"
          title="In Claude Code"
          code={`> /neuron-load pima ./pima.csv

# Claude reads the columns and confirms with you:
# "Found columns: pregnancies, glucose, blood_pressure, skin_thickness,
#  insulin, bmi, pedigree, age, outcome.
#  Use 'outcome' as label_column? [y/n]"

# After confirmation:
mcp__neuron__load_csv({
  task_id: "pima",
  path: "./pima.csv",
  label_column: "outcome",
  test_size: 0.2,
  stratify: "auto",
})

# 614 train / 154 test`}
        />
      </Section>

      <Section eyebrow="Step 3" title="Audit the data.">
        <p>
          Before training: is anything obviously wrong? <code>data_audit</code> tells you.
        </p>
        <CodeBlock
          lang="ts"
          code={`> What does data_audit say about pima?

mcp__neuron__data_audit({ task_id: "pima" })`}
        />
        <CodeBlock
          lang="json"
          title="Sample output"
          code={`{
  "ok": true,
  "verdict": "ready",
  "summary": "768 samples, 2 classes, 8 features, mild imbalance",
  "splits": { "train": 614, "test": 154 },
  "class_distribution": { "0": 500, "1": 268 },
  "imbalance_ratio": 1.87,
  "warnings": [],
  "training_budget": {
    "level": "safe",
    "peak_mb": 4,
    "wall_clock_estimate_s": [1, 5]
  }
}`}
        />
        <Callout kind="learn" title="What 'ready' means">
          The preflight verdict — <code>ready</code> means the data passes basic sanity checks: enough
          samples, both classes present, no constant features, no extreme scale issues.{" "}
          <code>warning</code> means trainable but worth investigating; <code>not_ready</code> means
          auto_train will refuse.
        </Callout>
      </Section>

      <Section eyebrow="Step 4" title="auto_train it.">
        <p>
          The headline command. Hand off everything to ML-Labs.
        </p>
        <CodeBlock
          lang="ts"
          title="In Claude Code"
          code={`> /neuron-auto pima 0.78

mcp__neuron__auto_train({
  task_id: "pima",
  accuracy_target: 0.78,    // a realistic target for Pima
  budget_s: 120,
  promote: true,
})`}
        />
        <p>
          Watch the dashboard (or call <code>get_auto_status</code> from another terminal) while this
          runs. You'll see:
        </p>
        <Timeline
          steps={[
            { step: "1", title: "Preflight", body: <>Data audit passes (already done above). Memory budget = safe.</>, accent: "cyan" },
            { step: "2", title: "Warm-start", body: <>If you've trained Pima before, pattern memory seeds with the prior winner. First time? Use suggest_hyperparams seed.</>, accent: "purple" },
            { step: "3", title: "Wave 1", body: <>3 configs in parallel sub-agents (small workload). The rules planner notices imbalance &gt; 1.5 and tries class_weights="balanced".</>, accent: "green" },
            { step: "4", title: "Wave 2", body: <>If wave 1 didn't hit 0.78, the planner refines based on signals — typically more epochs, slight lr changes, possibly weight_decay.</>, accent: "orange" },
            { step: "5", title: "Promote", body: <>Best run by val_accuracy is registered as the active model.</>, accent: "pink" },
            { step: "6", title: "Calibrate", body: <>Temperature fitted on the 154-sample test split. ECE drops from ~0.06 to ~0.02.</>, accent: "cyan" },
          ]}
        />

        <CodeBlock
          lang="json"
          title="Sample verdict"
          code={`{
  "status": "completed",
  "winner": {
    "run_id": 5,
    "metric_value": 0.792,
    "metric_name": "accuracy",
    "is_overfit": false,
    "confidence": "high",
    "config": {
      "lr": 0.001,
      "epochs": 800,
      "head_arch": [8, 32, 16, 2],
      "optimizer": "adamw",
      "loss": "cross_entropy",
      "class_weights": "balanced",
      "weight_decay": 0.0001
    }
  },
  "attempted": { "configs_tried": 6, "waves_used": 2, "wall_clock_s": 18 },
  "summary": "target reached: accuracy=0.792 on run 5"
}`}
        />
      </Section>

      <Section eyebrow="Step 5" title="Cross-validate to make sure.">
        <p>
          0.79 on a single test split is fine, but is it stable? Run 5-fold CV with the winner's config.
        </p>
        <CodeBlock
          lang="ts"
          code={`> Cross-validate the pima task.

mcp__neuron__cv_train({
  task_id: "pima",
  k: 5,
  optimizer: "adamw",
  weight_decay: 1e-4,
  class_weights: "balanced",
})

// {
//   mean_accuracy: 0.78,
//   std_accuracy: 0.025,
//   per_fold_accuracy: [0.75, 0.79, 0.81, 0.78, 0.77],
// }`}
        />
        <Callout kind="success">
          mean=0.78, std=0.025 → stable. If std were &gt; 0.05, you'd be in &ldquo;got lucky on one
          split&rdquo; territory and should investigate (more data? different stratification?).
        </Callout>
      </Section>

      <Section eyebrow="Step 6" title="Predict on a new patient.">
        <CodeBlock
          lang="ts"
          code={`> Predict for a patient with: pregnancies=6, glucose=148, bp=72, skin=35,
  insulin=0, bmi=33.6, pedigree=0.627, age=50

mcp__neuron__predict({
  task_id: "pima",
  features: [6, 148, 72, 35, 0, 33.6, 0.627, 50],
})

// {
//   label: "1",
//   confidence: 0.84,
//   scores: { "0": 0.16, "1": 0.84 }
// }
//
// confidence is calibrated (we ran calibrate already)`}
        />
      </Section>

      <Section eyebrow="Step 7" title="Publish for cross-project use.">
        <p>
          Drop this model into the registry so other projects can <code>import_model</code> it.
        </p>
        <CodeBlock
          lang="ts"
          code={`> /neuron-publish 5 pima-classifier

mcp__neuron__publish_model({
  run_id: 5,
  name: "pima-classifier",
  // version defaults to today's date
})

// → neuron://local/pima-classifier@2026-04-24

// Now from any other project:
mcp__neuron__import_model({
  uri: "neuron://local/pima-classifier@2026-04-24",
})`}
        />
      </Section>

      <Section eyebrow="Step 8" title="Wire it up — pretend month later.">
        <p>
          You've been using the model in production for a few weeks. The dashboard's predictions
          counter is at ~3000. Now check for drift.
        </p>
        <CodeBlock
          lang="ts"
          code={`> Run drift_check on pima.

mcp__neuron__drift_check({
  task_id: "pima",
  current_window: 1000,
})`}
        />
        <CodeBlock
          lang="json"
          title="Sample output"
          code={`{
  "ok": true,
  "task_id": "pima",
  "ref_window_size": 614,
  "cur_window_size": 1000,
  "features": [
    { "feature_name": "pregnancies",     "psi": 0.08, "verdict": "stable"   },
    { "feature_name": "glucose",         "psi": 0.21, "verdict": "drifting" },
    { "feature_name": "blood_pressure",  "psi": 0.04, "verdict": "stable"   },
    ...
  ],
  "verdict_summary": { "stable": 6, "drifting": 1, "severe": 1 }
}`}
        />
        <Callout kind="warn" title="Glucose is drifting">
          Population-level glucose readings have shifted since training. The PSI of 0.21 is in the
          drifting band (0.1–0.25). Decision time: re-train on the latest 30 days of data, or wait?
          That's a business question — but at least drift_check told you it's happening.
        </Callout>
      </Section>

      <Section eyebrow="Step 9" title="Retrain on fresh data.">
        <p>
          Pull recent labelled data, replace the training set, retrain.
        </p>
        <CodeBlock
          lang="ts"
          code={`> Reset the pima task and reload from the latest CSV.

mcp__neuron__reset_task({
  task_id: "pima",
  confirm: true,
})

mcp__neuron__load_csv({
  task_id: "pima",
  path: "./pima_2026-05.csv",
  label_column: "outcome",
  test_size: 0.2,
})

> /neuron-auto pima 0.78`}
        />
        <Callout kind="tip" title="Pattern memory pays off">
          The second auto_train on the same fingerprint warm-starts from the previous winning
          config. Wave 1 hits target faster.
        </Callout>
      </Section>

      <Section eyebrow="What you just did" title="The whole workflow in one diagram.">
        <div className="lab-panel p-6 my-6">
          <pre className="text-sm font-mono text-lab-text/85 whitespace-pre overflow-x-auto leading-relaxed">{`
   1. ml-labs init           ─► project scaffolded
   2. /neuron-load            ─► task created + CSV loaded + split
   3. data_audit              ─► verdict: ready
   4. /neuron-auto            ─► train + diagnose + promote + calibrate
   5. cv_train (k=5)          ─► confirm stability (std < 0.05)
   6. predict                 ─► single-sample inference
   7. /neuron-publish         ─► model lives in ~/.neuron/registry
   8. drift_check (later)     ─► found drift on glucose
   9. reset_task + retrain    ─► fresh model, pattern memory helps`}</pre>
        </div>
      </Section>

      <Section eyebrow="What's next" title="Adjacent recipes.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Workflow} title="More datasets" accent="cyan">
            Try the iris bench in QuickStart, or the housing regression in the examples folder. Each
            tests a different shape of problem.
          </InfoCard>
          <InfoCard icon={Database} title="Active learning" accent="green">
            Add a <code>collect()</code> callback to <code>neuron.config.ts</code> to have auto_train
            iterate on weak data points. See the <a href="/adapter-reference" className="text-green-neon hover:underline">Adapter Reference</a>.
          </InfoCard>
          <InfoCard icon={Trophy} title="Tournament mode" accent="purple">
            Set <code>tournament: true</code> on harder tasks — 3 parallel planners with different
            strategies often escape local optima.
          </InfoCard>
          <InfoCard icon={ShieldCheck} title="Validation pipeline" accent="orange">
            cv_train + calibrate + drift_check is the production-ready triple. See the{" "}
            <a href="/validation" className="text-orange-neon hover:underline">Validation</a> page.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
