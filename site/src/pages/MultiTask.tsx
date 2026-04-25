import { Layers, GitBranch } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function MultiTask() {
  return (
    <div>
      <PageHeader
        eyebrow="Several tasks, one project"
        accent="green"
        title={<><span className="gradient-text">Multi-task</span> projects.</>}
        lede="ML-Labs lets one project hold many tasks. Tasks share a database, a featurize callback (or several), and the registry. This page covers the patterns for organizing projects with multiple models — when to use one task vs many, when to share neuron.config.ts, when to split."
      />

      <Section eyebrow="The basic structure" title="One DB, many task rows.">
        <p>
          Every project's <code>data/neuron.db</code> can hold any number of rows in the{" "}
          <code>tasks</code> table. Each task is independent: own samples, own runs, own model. They
          share a process, a config file, a registry — that's it.
        </p>
        <CodeBlock
          lang="bash"
          code={`# Create three tasks in one project
mcp__neuron__create_task({ id: "churn", kind: "classification", feature_shape: [10] })
mcp__neuron__create_task({ id: "ltv",   kind: "regression",     feature_shape: [10] })
mcp__neuron__create_task({ id: "fraud", kind: "classification", feature_shape: [25] })

# Each gets its own samples, runs, models
mcp__neuron__list_tasks()
# → [
#     { id: "churn", kind: "classification", samples: 5000, accuracy: 0.81 },
#     { id: "ltv",   kind: "regression",     samples: 5000, mae: 18.4 },
#     { id: "fraud", kind: "classification", samples: 2000, accuracy: 0.94 }
#   ]`}
        />
      </Section>

      <Section eyebrow="When to use multiple tasks" title="Vs. one task with multi-output.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Layers} title="Separate tasks when..." accent="cyan">
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Tasks have different feature shapes</li>
              <li>One is classification, another is regression</li>
              <li>Each needs its own preprocessing</li>
              <li>You'll deploy / promote them independently</li>
              <li>Different stakeholders / users care about different ones</li>
            </ul>
          </InfoCard>
          <InfoCard icon={GitBranch} title="One task, multiple outputs when..." accent="purple">
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Outputs are correlated (multi-task learning helps)</li>
              <li>Same features, multiple labels</li>
              <li>You want a single model per inference call</li>
            </ul>
            <p className="mt-2 text-xs text-lab-muted">
              ML-Labs doesn't natively support multi-output today. Workaround: train K independent
              tasks, call all at predict time. For real multi-task learning, use PyTorch.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Sharing featurize" title="One callback, many tasks.">
        <p>
          <code>neuron.config.ts</code> applies to whichever task's <code>taskId</code> matches
          the running operation. For multi-task projects, a common pattern is per-task featurize
          via a switch:
        </p>
        <CodeBlock
          lang="ts"
          title="neuron.config.ts — multi-task featurize"
          code={`import sharp from "sharp"
import type { NeuronConfig } from "@neuron/mcp/src/adapter/types"

// One factory per task
const configs: Record<string, NeuronConfig> = {
  "churn": {
    taskId: "churn",
    featureShape: [10],
    // No featurize — load_csv numeric columns directly
  },

  "fraud": {
    taskId: "fraud",
    featureShape: [25],
    // Hand-crafted feature engineering
    featurize: async (raw: any) => engineerFraudFeatures(raw),
  },

  "image-class": {
    taskId: "image-class",
    featureShape: [1024],
    decodeImage: async (buf) => await sharp(buf).resize(32,32).grayscale().raw().toBuffer(),
    featurize: async (buf: Buffer) => Array.from(buf).map((v) => v / 255),
  },
}

// Default export is the active task
const ACTIVE_TASK = process.env.NEURON_ACTIVE_TASK ?? "churn"
export default configs[ACTIVE_TASK]!`}
        />
        <Callout kind="warn" title="A current limitation">
          ML-Labs's adapter loader picks ONE config per process. For multi-task projects where each
          task needs different featurize, you either (a) use the env-var switch above, or (b)
          consolidate the logic into one featurize that branches by task_id internally.
        </Callout>
      </Section>

      <Section eyebrow="Branching featurize" title="Single config, dispatches by taskId.">
        <CodeBlock
          lang="ts"
          title="One config, branched featurize"
          code={`export default defineNeuronConfig({
  taskId: "multi",   // not used — dispatches happen in featurize itself
  featureShape: [],   // overridden per task
  featurize: async (raw: any, taskId?: string) => {
    switch (taskId) {
      case "churn":
        return parseChurnRow(raw)   // → number[10]
      case "fraud":
        return engineerFraudFeatures(raw)  // → number[25]
      case "image-class":
        return await embedImage(raw)  // → number[1024]
      default:
        throw new Error(\`unknown taskId: \${taskId}\`)
    }
  },
})`}
        />
        <Callout kind="learn" title="When this matters">
          You only need to do this if your tasks have <em>structurally different</em> raw inputs.
          For pure tabular tasks, load_csv reads numeric columns and featurize is identity — no
          branching needed.
        </Callout>
      </Section>

      <Section eyebrow="Storage" title="Per-task isolation.">
        <p>
          The DB schema isolates everything by <code>task_id</code>. Foreign keys with{" "}
          <code>ON DELETE CASCADE</code> mean dropping one task cleans up its samples, runs, and
          model. Other tasks are untouched.
        </p>
        <CodeBlock
          lang="sql"
          title="Inspecting task isolation"
          code={`-- How big is each task in the DB?
SELECT
  t.id,
  COUNT(DISTINCT s.id) AS samples,
  COUNT(DISTINCT r.id) AS runs,
  CASE WHEN m.run_id IS NOT NULL THEN '✓' ELSE '✗' END AS has_model
FROM tasks t
LEFT JOIN samples s ON s.task_id = t.id
LEFT JOIN runs r ON r.task_id = t.id
LEFT JOIN models m ON m.task_id = t.id
GROUP BY t.id;`}
        />
      </Section>

      <Section eyebrow="Shared registry" title="Cross-task model sharing.">
        <p>
          The registry (<code>~/.neuron/registry.db</code>) is global, not per-project. So a model
          trained for the &ldquo;churn&rdquo; task in project A can be imported into project B's
          &ldquo;customer-prediction&rdquo; task — as long as feature shapes match and the adapter
          hash is compatible.
        </p>
        <CodeBlock
          lang="ts"
          code={`// Project A: train churn, publish
mcp__neuron__publish_model({
  run_id: 42, name: "churn-v1", version: "2026-04",
})

// Project B: import as a different task name
mcp__neuron__import_model({
  uri: "neuron://local/churn-v1@2026-04",
  task_id: "customer-churn-prediction",   // different name in this project
})

// Or load weights into an existing task
mcp__neuron__load_model({
  task_id: "customer-churn-prediction",
  uri: "neuron://local/churn-v1@2026-04",
})`}
        />
      </Section>

      <Section eyebrow="Patterns" title="Three multi-task project shapes.">
        <div className="space-y-4">
          <div className="lab-panel p-5 border-cyan-neon/30 border">
            <div className="font-semibold text-lab-heading mb-2">Pattern 1: Pipeline of models</div>
            <p className="text-sm text-lab-text/85 mb-3">
              Output of one model feeds another. Example: classify a support ticket's category
              (task A), route to per-category urgency model (task B), threshold for human review.
            </p>
            <CodeBlock
              lang="ts"
              code={`async function processTicket(text: string) {
  const category = await mcp__neuron__predict({ task_id: "ticket-category", features: await embed(text) })

  const urgencyTask = \`urgency-\${category.label}\`   // 5 separate urgency models
  const urgency = await mcp__neuron__predict({ task_id: urgencyTask, features: await embed(text) })

  return { category: category.label, urgency: urgency.value, route: urgency.value > 0.7 ? "human" : "auto" }
}`}
            />
          </div>

          <div className="lab-panel p-5 border-purple-neon/30 border">
            <div className="font-semibold text-lab-heading mb-2">Pattern 2: Parallel models on shared input</div>
            <p className="text-sm text-lab-text/85 mb-3">
              Same input features, multiple targets. Example: customer features → churn prediction
              + LTV regression + fraud risk. All three run in parallel for a holistic view.
            </p>
            <CodeBlock
              lang="ts"
              code={`async function customerScore(features: number[]) {
  const [churn, ltv, fraud] = await Promise.all([
    mcp__neuron__predict({ task_id: "churn", features }),
    mcp__neuron__predict({ task_id: "ltv", features }),
    mcp__neuron__predict({ task_id: "fraud", features }),
  ])
  return { churn: churn.confidence, ltv: ltv.value, fraud_score: fraud.confidence }
}`}
            />
          </div>

          <div className="lab-panel p-5 border-green-neon/30 border">
            <div className="font-semibold text-lab-heading mb-2">Pattern 3: A/B tournaments</div>
            <p className="text-sm text-lab-text/85 mb-3">
              Multiple variants of one task, kept side-by-side via task_id versioning. Example:{" "}
              <code>churn-v1</code>, <code>churn-v2</code>, <code>churn-v3</code>. Use shadow models
              to A/B in production.
            </p>
            <CodeBlock
              lang="ts"
              code={`// Treat each variant as its own task
mcp__neuron__create_task({ id: "churn-v2", ... })
mcp__neuron__load_csv({ task_id: "churn-v2", ... })
mcp__neuron__auto_train({ task_id: "churn-v2" })

// Compare side-by-side
mcp__neuron__compare_runs({
  run_ids: [getActiveRun("churn-v1"), getActiveRun("churn-v2")],
})`}
            />
          </div>
        </div>
      </Section>

      <Section eyebrow="Limits" title="Things multi-task in ML-Labs doesn't do.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Joint training across tasks.</strong> Each task trains independently. No multi-task learning shared backbone.</li>
          <li><strong>Cross-task hyperparameter tuning.</strong> auto_train runs on one task at a time.</li>
          <li><strong>Cross-task pattern memory.</strong> auto_patterns is fingerprinted by data shape, not task id — so two tasks with similar shape DO share warm-start patterns. But not in a structured way.</li>
        </ul>
        <Callout kind="learn" title="When you outgrow multi-task in ML-Labs">
          For genuine multi-task learning (shared encoder + per-task heads), you need PyTorch. ML-Labs
          remains useful as the orchestration / serving layer in front of a multi-task PyTorch
          model — you'd just have featurize call out to your PyTorch encoder.
        </Callout>
      </Section>
    </div>
  )
}
