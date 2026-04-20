import { Package, GitBranch, Compass, Fingerprint, Layers, Share2, AlertCircle, Lightbulb } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { DataFlow } from "../components/DataFlow"

export function RegistryLearning() {
  return (
    <div>
      <PageHeader
        eyebrow="Models that travel, datasets that improve"
        accent="pink"
        title={<><span className="gradient-text">Publish</span> a model. <span className="gradient-text">Point</span> at what to collect next.</>}
        lede="The registry makes trained models portable. suggest_samples makes training iterative. Together they turn Neuron from a training tool into a workflow."
      />

      <Section eyebrow="Registry" title="Share a model across projects.">
        <p>
          <code>publish_model</code> writes a bundle to{" "}
          <code>~/.neuron/registry/bundles/&lt;slug&gt;/</code> — weights, metadata, the adapter hash —
          and indexes it in <code>~/.neuron/registry.db</code>. Every other project on this machine
          can now <code>import_model</code> or <code>load_model</code> by URI.
        </p>

        <DataFlow
          nodes={[
            { label: "project A", sub: "train", accent: "cyan" },
            { label: "publish_model", sub: "writes bundle", accent: "purple" },
            { label: "~/.neuron/", sub: "registry", accent: "pink" },
            { label: "project B", sub: "import_model", accent: "green" },
            { label: "predict", sub: "inference", accent: "orange" },
          ]}
        />

        <CodeBlock
          lang="typescript"
          title="publish → import"
          code={`// In project A (where you trained iris):
await mcp__neuron__publish_model({
  run_id: 42,
  name: "iris-classifier",
  version: "2026-04-19",
})
// → neuron://local/iris-classifier@2026-04-19

// In project B (where you need a fast iris model):
await mcp__neuron__import_model({
  uri: "neuron://local/iris-classifier@2026-04-19",
})
// → creates task "iris", a synthetic run with status='imported',
//   and makes it the active model. No training needed.

// Predict works immediately:
await mcp__neuron__predict({
  task_id: "iris",
  features: [5.1, 3.5, 1.4, 0.2],
})`}
        />

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <InfoCard icon={Package} title="The bundle on disk" accent="purple">
            <pre className="text-xs font-mono text-lab-muted">
{`~/.neuron/registry/bundles/
  iris-classifier_2026-04-19/
    weights.json
    meta.json       (kind, feature_shape,
                     accuracy, labels)
    adapter.hash    (sha256 of
                     neuron.config.ts)`}
            </pre>
          </InfoCard>
          <InfoCard icon={Fingerprint} title="The adapter-hash guard" accent="pink">
            <code>neuron.config.ts</code> defines <em>featurize</em>. If project B's featurize is
            different, loading would silently produce garbage. <code>import_model</code> refuses
            unless hashes match — or you pass <code>force: true</code> knowingly.
          </InfoCard>
          <InfoCard icon={Compass} title="URI shape" accent="cyan">
            <code>neuron://local/&lt;name&gt;@&lt;version&gt;</code>. Version defaults to today's date if
            you don't pass one. <code>list_registry</code> filters by kind or tag.
          </InfoCard>
          <InfoCard icon={Share2} title="Cross-session predict, free" accent="orange">
            Imported models work across server restarts — same lazy weight-restore path as freshly
            trained ones. Nothing special to wire up.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Active learning" title="suggest_samples — the iteration engine.">
        <p>
          You have a 93%-accurate model. Where do you find the last 6%? You ask{" "}
          <code>suggest_samples</code>. It batch-evaluates every sample in one rs-tensor call,
          builds per-class accuracy and confidence stats, flags the rows the model got wrong or
          was unsure about, and emits bullet-pointed recommendations for what to collect more of.
        </p>

        <CodeBlock
          lang="typescript"
          title="where to spend your labeling budget"
          code={`const report = await mcp__neuron__suggest_samples({
  task_id: "iris",
  n_suggestions: 5,
  confidence_threshold: 0.7,
})

// report = {
//   n_samples: 150,
//   overall_accuracy: 0.953,
//   per_class: [
//     { label: "setosa",     count: 50, accuracy: 1.00, avg_confidence: 0.98 },
//     { label: "versicolor", count: 50, accuracy: 0.94, avg_confidence: 0.82 },
//     { label: "virginica",  count: 50, accuracy: 0.92, avg_confidence: 0.76 },
//   ],
//   uncertain_samples: [
//     { sample_id: 107, true_label: "virginica",
//       predicted_label: "versicolor", confidence: 0.52, features: [...] },
//     ...
//   ],
//   recommendations: [
//     "virginica averages 76% confidence — lowest of any class. Add ~20 borderline examples.",
//     "versicolor/virginica boundary has 4 misclassifications. Focus there.",
//   ],
// }`}
        />

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <InfoCard icon={Layers} title="Batch eval = one tensor call" accent="cyan">
            All N samples go into a single <code>[N, D]</code> tensor.{" "}
            <code>evaluate_mlp</code> returns <code>[N, K]</code> logits. We softmax/argmax in TS.
            Nothing per-sample — 150 iris samples take ~20ms.
          </InfoCard>
          <InfoCard icon={AlertCircle} title="Uncertain ≠ wrong" accent="orange">
            We surface both <strong>misclassified</strong> samples and correctly-classified
            samples with confidence under <code>confidence_threshold</code>. Both signal data gaps.
          </InfoCard>
          <InfoCard icon={GitBranch} title="Plugs into auto_train" accent="purple">
            When <code>auto_train</code> can't hit the accuracy target after all waves, it calls{" "}
            <code>suggest_samples</code> and bakes the recommendations into its final verdict.
          </InfoCard>
          <InfoCard icon={Lightbulb} title="Calibration caveat" accent="pink">
            Raw MSE-trained softmax is not temperature-calibrated — "0.7 confidence" is loose.
            Treat <code>confidence_threshold</code> as a relative knob, not a probability.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="The workflow this enables" title="Build → publish → improve — on repeat.">
        <DataFlow
          nodes={[
            { label: "auto_train", sub: "pipeline", accent: "cyan" },
            { label: "publish_model", sub: "v1", accent: "purple" },
            { label: "suggest_samples", sub: "find gaps", accent: "green" },
            { label: "collect more", sub: "label", accent: "orange" },
            { label: "auto_train again", sub: "v2", accent: "pink" },
          ]}
        />
        <p>
          Version every published model by date. Keep the old ones in the registry. You can roll
          forward or back by swapping URIs — and the adapter-hash check stops you from loading an
          incompatible one by accident.
        </p>
      </Section>
    </div>
  )
}
