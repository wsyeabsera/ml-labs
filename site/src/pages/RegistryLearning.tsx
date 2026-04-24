import { Package, GitBranch, Compass, Fingerprint, Layers, Share2, AlertCircle, Lightbulb } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { DataFlow } from "../components/DataFlow"
import { Callout } from "../components/Callout"

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
})

// Offline alternative: bundle round-trip (v1.6.2)
// Project A: writes a bundle dir to an arbitrary path
await mcp__neuron__export_model({
  task_id: "iris",
  bundle_path: "/Users/yab/models/iris-v1",
})
// Project B: reads the bundle (scp it first if on a different machine)
await mcp__neuron__import_model({
  bundle_path: "/Users/yab/models/iris-v1",
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
          <InfoCard icon={Lightbulb} title="Calibrate before trusting confidence" accent="pink">
            Raw softmax is not temperature-calibrated — &ldquo;0.7 confidence&rdquo; is loose. Call{" "}
            <code>calibrate(run_id)</code> after training; it fits a temperature T on the val split
            so confidences reflect empirical accuracy. auto_train does this automatically. See the
            <a href="/validation" className="text-pink-neon hover:underline"> Validation</a> page.
          </InfoCard>
        </div>

        <Callout kind="tip" title="v1.6.1 fix — normalized features">
          Prior to v1.6.1, <code>suggest_samples</code> was feeding <em>unnormalized</em> features to
          the predictor when the task had <code>normalize=true</code>, producing wrong uncertainty
          scores. Every normalized task silently surfaced wrong uncertain samples. Fixed — but a
          reminder that the data path matters: predict/batch_predict/suggest_samples all share one
          normalization code path now.
        </Callout>
      </Section>

      <Section eyebrow="Auto-collect loop" title="auto_train calls suggest_samples too.">
        <p>
          If you pass <code>auto_collect: true</code> to <code>auto_train</code>, after normal waves
          complete (and the target isn't hit yet), the controller calls <code>suggest_samples</code>,
          hands the uncertain rows to your <code>collect()</code> callback in{" "}
          <code>neuron.config.ts</code>, inserts the returned samples, and runs one more refinement
          wave. Up to <code>max_collect_rounds</code> iterations.
        </p>
        <CodeBlock
          lang="ts"
          title="neuron.config.ts — a collect() callback"
          code={`export default {
  async collect({ uncertain_samples, recommendations }) {
    // Called by auto_train when auto_collect: true.
    // Return new samples to feed back into training.
    //
    // uncertain_samples: the rows the model got wrong or was unsure about.
    // recommendations: human-readable hints from suggest_samples.
    const extras = await generateFromLLMOrLabel(uncertain_samples)
    return extras  // [{ label, features, raw? }]
  },
}`}
        />
        <p>
          Without a callback, <code>auto_collect: true</code> is a no-op — ML-Labs won't fabricate
          data behind your back. Full details in{" "}
          <a href="/auto-train-deep-dive" className="text-purple-neon hover:underline">Auto-Train Deep Dive § step 7</a>.
        </p>
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
