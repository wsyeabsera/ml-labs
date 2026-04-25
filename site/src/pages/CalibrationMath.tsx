import { Scale, Sigma, Activity } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { InfoCard } from "../components/InfoCard"

export function CalibrationMath() {
  return (
    <div>
      <PageHeader
        eyebrow="The math behind temperature scaling"
        accent="pink"
        title={<><span className="gradient-text">Calibration</span> math.</>}
        lede="The Validation page introduced calibrate as 'fits a temperature on held-out logits.' That sentence is doing a lot of work. This page derives temperature scaling from negative log-likelihood, builds the intuition for why it works, explains ECE, and shows what a reliability diagram is."
      />

      <Section eyebrow="The problem" title="Confidence ≠ accuracy.">
        <p>
          Modern neural nets are over-confident. A model with 90% top-1 accuracy might output{" "}
          <code>confidence = 0.99</code> on most predictions. If you act on that confidence —
          thresholding, ranking, escalation — you're acting on noise.
        </p>
        <p>
          A <strong>calibrated</strong> classifier produces confidences that match empirical
          accuracy. Among predictions with confidence 0.7, ~70% are right. Among confidence 0.9,
          ~90% are right. Same for every confidence bucket.
        </p>
      </Section>

      <Section eyebrow="The trick" title="Divide logits by a temperature T.">
        <p>
          The fix is shockingly simple. Take the logits the model produces, divide them by a single
          scalar T &gt; 0, then softmax. Done.
        </p>
        <CodeBlock
          lang="ts"
          title="The whole calibration"
          code={`// Before
softmax(logits)

// After (with calibrated T)
softmax(logits.map((z) => z / T))`}
        />
        <p>
          One scalar. T &gt; 1 → tempered (less confident). T &lt; 1 → sharpened (more confident).
          T = 1 → identity, no change.
        </p>
        <Callout kind="learn" title="Why this doesn't change accuracy">
          Softmax preserves order: dividing all logits by a positive constant doesn't change which
          one is largest. So argmax of softmax(logits/T) = argmax of softmax(logits). Top-1
          accuracy is unaffected. Only the <em>distribution</em> of confidence shifts.
        </Callout>
      </Section>

      <Section eyebrow="Where T comes from" title="Minimise NLL on held-out data.">
        <p>
          Pick T to minimise negative log-likelihood on the held-out set:
        </p>
        <CodeBlock
          lang="ts"
          title="The fitting objective"
          code={`function nllAt(logits: number[][], labels: number[], T: number): number {
  let total = 0
  for (let i = 0; i < logits.length; i++) {
    // Stable log-softmax = logits/T - logsumexp(logits/T)
    const scaled = logits[i].map((z) => z / T)
    const max = Math.max(...scaled)
    const lse = max + Math.log(scaled.reduce((s, z) => s + Math.exp(z - max), 0))
    total -= scaled[labels[i]] - lse   // -log p(correct)
  }
  return total / logits.length
}

// Find T that minimises NLL — log-space grid search
function fitTemperature(logits: number[][], labels: number[]): number {
  let bestT = 1
  let bestNLL = Infinity
  for (let logT = -2; logT <= 2; logT += 0.05) {
    const T = Math.exp(logT)
    const nll = nllAt(logits, labels, T)
    if (nll < bestNLL) { bestNLL = nll; bestT = T }
  }
  return bestT
}`}
        />
        <Callout kind="learn" title="Why log-space search">
          T's effective range is multiplicative: T=2 vs T=2.01 is barely different; T=2 vs T=4 is
          big. Log-space spacing (e^-2, e^-1.95, e^-1.9, ...) gives uniform coverage of the
          interesting range. ML-Labs uses 81 candidates from T=e^-2 ≈ 0.14 to T=e^2 ≈ 7.4.
        </Callout>
      </Section>

      <Section eyebrow="Why NLL minimisation calibrates" title="The intuition.">
        <p>
          NLL is <code>-Σ log(p_correct)</code>. Imagine the model is over-confident: it outputs
          0.99 on the correct class but is right only 90% of the time. The 10% it gets wrong
          contribute <code>-log(0.01) = 4.6</code> each — huge punishment. NLL drops sharply if you
          temper that 0.99 to 0.9 (so wrongs only contribute <code>-log(0.1) = 2.3</code>).
        </p>
        <p>
          So NLL minimisation rewards humble probabilities when accuracy doesn't match confidence.
          Conversely, an under-confident model gets sharpened: confidence 0.6 on a 90%-accurate
          subset is too humble; sharpening (T &lt; 1) raises NLL on the 90% it gets right while
          lowering it on the 10% it gets wrong — net win.
        </p>
      </Section>

      <Section eyebrow="ECE — Expected Calibration Error" title="How calibrated are we?">
        <p>
          Reliability metric. Bucket predictions by predicted confidence (e.g. 10 bins for [0.0,
          0.1), [0.1, 0.2), ...). For each bucket, compute (mean confidence) and (empirical
          accuracy). ECE is the weighted average gap.
        </p>
        <CodeBlock
          lang="ts"
          title="ECE in code"
          code={`function ece(predictions: { confidence: number; correct: boolean }[]): number {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, conf_sum: 0, correct_count: 0 }))

  for (const p of predictions) {
    const idx = Math.min(9, Math.floor(p.confidence * 10))
    bins[idx].count++
    bins[idx].conf_sum += p.confidence
    if (p.correct) bins[idx].correct_count++
  }

  const N = predictions.length
  let total = 0
  for (const b of bins) {
    if (b.count === 0) continue
    const meanConf = b.conf_sum / b.count
    const accuracy = b.correct_count / b.count
    total += (b.count / N) * Math.abs(meanConf - accuracy)
  }
  return total
}`}
        />

        <Callout kind="learn" title="What 'good' ECE looks like">
          <ul className="list-disc list-inside space-y-1 text-sm mt-1">
            <li><strong>0.00-0.02</strong> — well-calibrated. Production-quality.</li>
            <li><strong>0.02-0.05</strong> — typical for a calibrated MLP.</li>
            <li><strong>0.05-0.10</strong> — typical for an uncalibrated MLP. Acceptable for non-confidence-aware uses; unacceptable if you act on confidence.</li>
            <li><strong>0.10+</strong> — badly calibrated. Calibrate or stop trusting the confidences.</li>
          </ul>
        </Callout>
      </Section>

      <Section eyebrow="Reliability diagrams" title="Visualising calibration.">
        <p>
          Plot predicted confidence (x) against empirical accuracy (y) per bucket. Perfect
          calibration is the diagonal y=x. Above the diagonal = under-confident; below = over-confident.
        </p>
        <AsciiDiagram title="Reliability diagram before vs after calibration" accent="pink">
{`     accuracy
        1.0 ┤                              ┌── y = x (ideal)
            │                          ┌───
            │                       ┌──     ◆ before (over-confident)
        0.8 ┤    ◆                ┌─       ◆
            │       ◆           ┌─    ◆
            │           ◆     ┌─   ◆        ● after temperature scaling
        0.6 ┤              ◆ ┌─ ◆            (close to diagonal)
            │              ┌─◆
            │             ┌─    ●        ●
        0.4 ┤           ┌─        ●     ●
            │         ┌─            ● ●
            │       ┌─           ●
        0.2 ┤     ┌─
            │   ┌─
            └───┴────┴────┴────┴────┴────┴────  predicted confidence
                0.2  0.4  0.6  0.8  1.0`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="When temperature scaling isn't enough" title="The limitations.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Single-parameter.</strong> One T fits all classes. Per-class miscalibration (model is over-confident on class A, under-confident on class B) survives.</li>
          <li><strong>Won't fix accuracy.</strong> Calibration ≠ correctness. A 70% accurate model becomes a 70% accurate <em>calibrated</em> model.</li>
          <li><strong>Needs val data.</strong> No held-out split → no calibration. ML-Labs's calibrate refuses without one.</li>
        </ul>
        <Callout kind="learn" title="More sophisticated alternatives">
          <strong>Vector scaling:</strong> per-class T. <strong>Matrix scaling:</strong> a full K×K
          calibration matrix. <strong>Histogram binning / isotonic regression:</strong> non-parametric
          calibrators. Use these for high-stakes applications. ML-Labs ships temperature scaling
          because it's robust (one parameter, hard to overfit) and 80% as good as the fancier
          alternatives in practice.
        </Callout>
      </Section>

      <Section eyebrow="Reference" title="Files and citations.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Sigma} title="Source" accent="cyan">
            <code>neuron/src/core/calibration.ts</code> — fitTemperature, nllAt, stable logSoftmax.
            ~80 lines.
          </InfoCard>
          <InfoCard icon={Scale} title="Test" accent="purple">
            <code>neuron/test/unit/calibration.test.ts</code> — sanity tests for T &gt; 1 case
            (tempering), T &lt; 1 case (sharpening), and that argmax is preserved.
          </InfoCard>
          <InfoCard icon={Activity} title="The original paper" accent="green">
            <a href="https://arxiv.org/abs/1706.04599" className="text-green-neon hover:underline" target="_blank" rel="noreferrer">
              Guo et al., 2017 — On Calibration of Modern Neural Networks
            </a>
            . Where temperature scaling for neural nets came from. Readable.
          </InfoCard>
          <InfoCard icon={Sigma} title="ECE intro" accent="orange">
            <a href="https://towardsdatascience.com/expected-calibration-error-ece-a-step-by-step-visual-explanation-with-python-code-c3e9aa12937d" className="text-orange-neon hover:underline" target="_blank" rel="noreferrer">
              ECE step-by-step
            </a>{" "}
            — visual walkthrough of computing ECE with reliability diagrams.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
