import {
  GitBranch, Scale, Activity, ShieldCheck, Thermometer, AlertOctagon,
  CircleCheck, CheckCircle2,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function Validation() {
  return (
    <div>
      <PageHeader
        eyebrow="Trust but verify"
        accent="green"
        title={<>Validation & <span className="gradient-text">reliability</span>.</>}
        lede="Training is half the story. These tools answer: Did I just get lucky on one split? Are my confidences actually meaningful? Has the world shifted since I deployed? Is my data even clean to start with?"
      />

      <Section eyebrow="Four tools, four questions" title="The reliability toolkit.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={CircleCheck} title="data_audit" accent="cyan">
            Before you train: is the data even usable? Combines <code>inspect_data</code> +{" "}
            <code>preflight_check</code> into one call. Returns class distribution, imbalance ratio,
            warnings, split sizes, and a <code>ready / warning / not_ready</code> verdict.
          </InfoCard>
          <InfoCard icon={GitBranch} title="cv_train" accent="purple">
            After you train once: does the accuracy hold up across different splits? K-fold
            cross-validation trains k models on rotating folds and reports mean ± std of the primary
            metric.
          </InfoCard>
          <InfoCard icon={Thermometer} title="calibrate" accent="pink">
            After you deploy: when the model says 90% confidence, is it actually right ~90% of the
            time? Temperature scaling fits a single scalar T on a held-out set to match confidence to
            empirical accuracy.
          </InfoCard>
          <InfoCard icon={Activity} title="drift_check" accent="orange">
            While you run in production: have the features you're seeing now drifted from the
            features you trained on? Per-feature PSI + KS test produces a{" "}
            <code>stable / drifting / severe</code> verdict.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="data_audit" title="Is the data ready at all?">
        <p>
          One MCP call that does what Claude usually does at the start of a session: inspect the data
          shape, check for constant features, measure class balance, and confirm there are enough
          samples to train. Comes first because there is no point in cross-validating rubbish.
        </p>
        <CodeBlock
          lang="json"
          title="data_audit(&quot;iris&quot;) — sample output"
          code={`{
  "ok": true,
  "task_id": "iris",
  "verdict": "ready",
  "summary": "150 samples, 3 classes (50/50/50), 4 features, no warnings",
  "total": 150,
  "splits": { "train": 120, "test": 30 },
  "class_distribution": { "setosa": 50, "versicolor": 50, "virginica": 50 },
  "imbalance_ratio": 1.0,
  "warnings": []
}`}
        />
        <Callout kind="learn" title="Verdict meanings">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>ready</strong> — no blocking issues, go ahead and train.</li>
            <li><strong>warning</strong> — trainable but something's off (mild imbalance, high feature variance). Look at the warnings first.</li>
            <li><strong>not_ready</strong> — blocking issue (too few samples, only one class). auto_train will refuse to run.</li>
          </ul>
        </Callout>
      </Section>

      <Section eyebrow="cv_train — k-fold cross-validation" title="Same metric, k ways.">
        <p>
          A single train/test split gives you a single accuracy number — which might be 2% high (you
          got lucky) or 2% low (you got unlucky). K-fold cross-validation trains k models, each using
          a different fold as the held-out set, and reports the mean and standard deviation.
        </p>

        <AsciiDiagram title="5-fold CV — 150 samples, 30 per fold" accent="purple">
{`              ┌─────┬─────┬─────┬─────┬─────┐
   Fold 1:    │ TEST│train│train│train│train│   → acc₁
              ├─────┼─────┼─────┼─────┼─────┤
   Fold 2:    │train│ TEST│train│train│train│   → acc₂
              ├─────┼─────┼─────┼─────┼─────┤
   Fold 3:    │train│train│ TEST│train│train│   → acc₃
              ├─────┼─────┼─────┼─────┼─────┤
   Fold 4:    │train│train│train│ TEST│train│   → acc₄
              ├─────┼─────┼─────┼─────┼─────┤
   Fold 5:    │train│train│train│train│ TEST│   → acc₅
              └─────┴─────┴─────┴─────┴─────┘
                             │
                             ▼
               mean ± std  (reported)`}
        </AsciiDiagram>

        <CodeBlock
          lang="json"
          title="cv_train({ task_id: &quot;iris&quot;, k: 5 }) — sample output"
          code={`{
  "ok": true,
  "parent_run_id": 10,        // placeholder row that groups the folds
  "k": 5,
  "fold_run_ids": [11, 12, 13, 14, 15],
  "per_fold_accuracy": [0.967, 0.933, 1.000, 0.967, 0.933],
  "mean_accuracy": 0.960,
  "std_accuracy": 0.027,
  "metric_name": "accuracy"
}`}
        />

        <Table
          columns={[
            { key: "arg",     header: "Argument",    mono: true },
            { key: "default", header: "Default",     mono: true },
            { key: "meaning", header: "Meaning" },
          ]}
          rows={[
            { arg: "k",            default: "5",      meaning: "Number of folds. 5 or 10 are conventional. With N<100, try 3 or 5." },
            { arg: "stratify",     default: '"auto"', meaning: 'Preserve class proportions across folds. "auto" enables for classification, off for regression.' },
            { arg: "seed",         default: "NEURON_SEED", meaning: "Determines fold assignment. Same seed + same labels = same folds, always." },
            { arg: "lr / epochs /…", default: "suggested", meaning: "Same training args as train. Apply to every fold." },
          ]}
        />

        <Callout kind="tip">
          The standard deviation is as important as the mean. If <code>mean=0.95, std=0.03</code>, your
          model is stable. If <code>mean=0.95, std=0.15</code>, you got lucky on some folds and
          unlucky on others — investigate before deploying.
        </Callout>
      </Section>

      <Section eyebrow="calibrate — temperature scaling" title="Make confidence mean something.">
        <p>
          A classifier's softmax outputs look like probabilities (they sum to 1.0, they're between 0
          and 1), but they often aren't <em>calibrated</em>: when the model says 95% confidence, it
          might actually be right 99% of the time (under-confident) or 80% of the time (over-confident).
          For anything where you act on the confidence — flagging low-confidence predictions, setting
          thresholds — this matters.
        </p>
        <CodeBlock
          lang="ts"
          title="core/calibration.ts (algorithm)"
          code={`// Find T > 0 that minimises negative log-likelihood on held-out data:
//   softmax_T(logits)[i] = softmax(logits / T)[i]
//   NLL(T) = -mean( log softmax_T(logits)[true_label] )
//
// T < 1  → sharpens (model was under-confident)
// T > 1  → tempers  (model was over-confident)
// T = 1  → no change
//
// One scalar, fit by log-space grid search. Fast, deterministic, robust.`}
        />

        <AsciiDiagram title="A reliability diagram — before vs after calibration" accent="pink">
{`   Perfect calibration:  predicted confidence = empirical accuracy
                    (the diagonal line)

     accuracy
        1.0 ┤                                ┌─── ideal (y = x)
            │                            ┌───
            │  before (overconfident)  ┌─
        0.8 ┤     ◆                  ┌─     ◆
            │        ◆             ┌─    ◆
            │            ◆       ┌─   ◆
        0.6 ┤               ◆  ┌─  ◆
            │                 ┌─◆              ◆  before: acc < confidence
            │                ┌─                ●  after:  acc ≈ confidence
        0.4 ┤              ┌─●               ●
            │            ┌─   ●           ●
            │          ┌─        ●     ●
        0.2 ┤        ┌─             ●
            │      ┌─
            └──────┴──────┴──────┴──────┴──────
               0.2    0.4    0.6    0.8    1.0
                            confidence`}
        </AsciiDiagram>

        <Table
          columns={[
            { key: "what",   header: "What" },
            { key: "before", header: "Before calibrate", accent: "orange" },
            { key: "after",  header: "After calibrate",  accent: "green" },
          ]}
          rows={[
            { what: "Softmax output",  before: "Logits / 1 → softmax",         after: "Logits / T → softmax" },
            { what: "ECE",             before: "0.04 - 0.10 typical for MLPs",  after: "0.01 - 0.03 typical" },
            { what: "Top-1 accuracy",  before: "(unchanged — T doesn't flip argmax)", after: "Identical" },
            { what: "Confidence scores", before: "Roughly right but often too high",   after: "Roughly right AND calibrated" },
          ]}
        />

        <CodeBlock
          lang="json"
          title="calibrate({ run_id: 42 }) — sample output"
          code={`{
  "ok": true,
  "run_id": 42,
  "temperature": 1.234,
  "ece_before": 0.062,
  "ece_after": 0.018,
  "nll_before": 0.284,
  "nll_after": 0.232
}`}
        />

        <Callout kind="learn" title="ECE = Expected Calibration Error">
          Bucket predictions by predicted confidence (10 bins, 0.0-0.1, 0.1-0.2, …). In each bucket,
          compute |mean_confidence − empirical_accuracy|. Take the weighted average. ECE of 0 means
          perfect calibration; ECE of 0.05 means confidences are off by about 5 percentage points on
          average. auto_train reports before/after ECE automatically after promoting a winner.
        </Callout>
      </Section>

      <Section eyebrow="drift_check — production monitoring" title="Has the world changed?">
        <p>
          You trained a model on historical data. Weeks later the data it sees in production looks
          different — feature distributions shift, new customer types appear, the season changes. A
          model that was 95% accurate a month ago might be 85% now without obviously failing —
          predictions still come out, just wrong more often. <code>drift_check</code> compares the{" "}
          <strong>reference distribution</strong> (your training data) against a{" "}
          <strong>current window</strong> (recent <code>predict</code> / <code>batch_predict</code>{" "}
          calls, stored in the <code>predictions</code> table).
        </p>

        <Table
          caption="Per-feature signals returned by drift_check"
          columns={[
            { key: "signal",   header: "Signal",  accent: "orange" },
            { key: "range",    header: "Range" },
            { key: "meaning",  header: "Meaning" },
          ]}
          rows={[
            { signal: "PSI (Population Stability Index)", range: "[0, ∞)",    meaning: "Weighted sum of relative frequency differences across 10 bins. <0.1 stable, 0.1-0.25 drifting, >0.25 severe (Evidently / NannyML defaults)." },
            { signal: "KS statistic",                     range: "[0, 1]",    meaning: "Max absolute CDF difference between reference and current. Higher = more divergent." },
            { signal: "KS p-value",                       range: "[0, 1]",    meaning: "Probability that the two samples came from the same distribution. <0.05 is significant." },
            { signal: "Verdict",                          range: "stable / drifting / severe / insufficient_data", meaning: "Rolled up from PSI + KS. Use as the actionable field." },
          ]}
        />

        <CodeBlock
          lang="json"
          title="drift_check({ task_id: &quot;iris&quot;, current_window: 500 }) — excerpt"
          code={`{
  "ok": true,
  "task_id": "iris",
  "ref_window_size": 120,
  "cur_window_size": 487,
  "features": [
    { "feature_idx": 0, "feature_name": "sepal_length", "psi": 0.042, "ks_p_value": 0.31, "verdict": "stable"   },
    { "feature_idx": 1, "feature_name": "sepal_width",  "psi": 0.089, "ks_p_value": 0.12, "verdict": "stable"   },
    { "feature_idx": 2, "feature_name": "petal_length", "psi": 0.31,  "ks_p_value": 0.002, "verdict": "severe" },
    { "feature_idx": 3, "feature_name": "petal_width",  "psi": 0.18,  "ks_p_value": 0.04, "verdict": "drifting" }
  ],
  "verdict_summary": { "stable": 2, "drifting": 1, "severe": 1, "insufficient_data": 0 }
}`}
        />

        <Callout kind="warn">
          For <code>drift_check</code> to work, the <code>predictions</code> table must have recent
          entries. Running <code>predict</code> / <code>batch_predict</code> records each call
          automatically. If you've only used the model in Claude sessions, let it run a few predictions
          first before asking for a drift check.
        </Callout>
      </Section>

      <Section eyebrow="When to use which" title="Recipes.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={ShieldCheck} title="Before training" accent="cyan">
            <code>data_audit</code> first. If it says <code>not_ready</code>, don't train — load more
            data or fix warnings. auto_train also calls this automatically in its preflight step.
          </InfoCard>
          <InfoCard icon={GitBranch} title="After training, before promoting" accent="purple">
            <code>cv_train</code> with <code>k=5</code> on small data or <code>k=3</code> if you're in
            a hurry. If std is &gt;0.05 you probably shouldn't trust a single-split number.
          </InfoCard>
          <InfoCard icon={Scale} title="If you care about confidence scores" accent="pink">
            <code>calibrate</code> on the promoted run. auto_train does this for you automatically on
            classification winners with a val split. For manual calibration, call directly on any
            completed classification run.
          </InfoCard>
          <InfoCard icon={AlertOctagon} title="After a model has been predicting for a while" accent="orange">
            Schedule <code>drift_check</code> weekly / monthly. Feed the verdicts into an alerting
            rule — e.g. if any feature's verdict is <code>severe</code>, retrain on recent data.
          </InfoCard>
          <InfoCard icon={CheckCircle2} title="Combined &ldquo;is this production-ready?&rdquo;" accent="green">
            <ol className="list-decimal list-inside space-y-0.5">
              <li><code>data_audit</code> → ready</li>
              <li><code>auto_train</code> → promoted + calibrated</li>
              <li><code>cv_train(k=5)</code> → mean ± std looks acceptable</li>
              <li>Deploy, then schedule <code>drift_check</code></li>
            </ol>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "40%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "tools/data_audit.ts",       what: "The MCP tool — delegates to inspect_data + preflight_check." },
            { file: "tools/cv_train.ts",         what: "The MCP tool — orchestrates k rotating fold trainings." },
            { file: "core/kfold.ts",             what: "kfoldAssign() — stratified + plain k-fold assignment." },
            { file: "tools/calibrate.ts",        what: "The MCP tool — reads val split, fits T, persists to runs.calibration_temperature." },
            { file: "core/calibration.ts",       what: "fitTemperature() + nllAt() + stable logSoftmax." },
            { file: "tools/drift_check.ts",      what: "The MCP tool — pulls recent predictions, feeds to driftReportFromArrays." },
            { file: "core/drift.ts",             what: "PSI + KS implementation, bucketing, verdict rollup." },
            { file: "core/db/predictions.ts",    what: "The predictions table — every predict/batch_predict writes here." },
          ]}
        />
      </Section>
    </div>
  )
}
