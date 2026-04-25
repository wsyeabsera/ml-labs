import { TrendingUp, Layers, Activity } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function TimeSeries() {
  return (
    <div>
      <PageHeader
        eyebrow="Forecasting + classification on temporal data"
        accent="orange"
        title={<><span className="gradient-text">Time series</span> with ML-Labs.</>}
        lede="ML-Labs has no native time-series support — no LSTM, no Transformer, no temporal convolutions. But for many forecasting and classification problems on time-stamped data, the sliding-window pattern + an MLP gets you 90% of the way. This page shows the pattern."
      />

      <Section eyebrow="The pattern" title="Sliding window → tabular features.">
        <p>
          Take any time series. Slide a window of length L over it. Each window becomes one sample;
          the value(s) just <em>after</em> the window become the label. Now it's a tabular ML problem.
        </p>
        <AsciiDiagram title="Sliding window with L=4, predicting next value" accent="orange">
{`   Original series (price over time):
     [10, 11, 13, 14, 15, 16, 18, 20, 22, 25, 27, 30, ...]

   Window 1: features=[10, 11, 13, 14], label=15
   Window 2: features=[11, 13, 14, 15], label=16
   Window 3: features=[13, 14, 15, 16], label=18
   ...
   Window N: features=[27, 30, ...], label=?

   featureShape = [L]   (here L=4)
   kind = "regression"
   ML-Labs trains an MLP that maps window → next value.`}
        </AsciiDiagram>
        <Callout kind="learn" title="What you lose">
          The window is the entire context the model sees — anything older than L steps is invisible.
          For recurrent patterns this works fine. For long-term seasonality (yearly patterns from
          monthly data), L needs to be large enough to span them.
        </Callout>
      </Section>

      <Section eyebrow="Step 1" title="Build the windowed dataset.">
        <CodeBlock
          lang="ts"
          title="Pre-process to a CSV"
          code={`import { readFileSync, writeFileSync } from "node:fs"

// 1. Read the raw time series
const rows = readFileSync("./prices.csv", "utf-8")
  .split("\\n")
  .slice(1)              // skip header
  .map((r) => parseFloat(r.split(",")[1]))   // value column
  .filter((v) => !isNaN(v))

// 2. Slide a window of length L=8
const L = 8
const out: string[] = ["x0,x1,x2,x3,x4,x5,x6,x7,target"]

for (let i = 0; i < rows.length - L; i++) {
  const window = rows.slice(i, i + L)
  const target = rows[i + L]
  out.push([...window, target].join(","))
}

writeFileSync("./windowed.csv", out.join("\\n"))
// Now windowed.csv is a regular tabular CSV: 8 features + 1 target.`}
        />
      </Section>

      <Section eyebrow="Step 2" title="Train as a regression task.">
        <CodeBlock
          lang="ts"
          code={`mcp__neuron__create_task({
  id: "price-forecast",
  kind: "regression",
  feature_shape: [8],
  normalize: true,
})

mcp__neuron__load_csv({
  task_id: "price-forecast",
  path: "./windowed.csv",
  label_column: "target",
  test_size: 0.2,
})

mcp__neuron__auto_train({ task_id: "price-forecast" })
// Watch for R² ≥ 0.5 — that's the "better than predicting the mean" bar.`}
        />
        <Callout kind="warn" title="Stratify won't help here">
          For regression, <code>stratify</code> is a no-op. The default time-series split is also
          shuffled — so train and test windows can overlap in time. For honest forecasting eval,
          use a time-cut split (last 20% of windows as test) instead of random.
        </Callout>
      </Section>

      <Section eyebrow="Time-cut split" title="The honest validation pattern.">
        <p>
          Random splits leak future information into training (a window from January 5 might be in
          train, the window from January 4 in test — the model effectively peeks at the future).
          For forecasting, split by time:
        </p>
        <CodeBlock
          lang="ts"
          title="Time-cut split"
          code={`// Skip ML-Labs's auto-stratification. Manually mark splits.
import { Database } from "bun:sqlite"

const db = new Database("./data/neuron.db")

// First load with everything as train (test_size=0)
mcp__neuron__load_csv({
  task_id: "price-forecast",
  path: "./windowed.csv",
  label_column: "target",
  test_size: 0,
})

// Then move the last 20% to test
const total = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM samples").get()!.c
const cutoff = Math.floor(total * 0.8)
db.exec(\`UPDATE samples SET split = 'test' WHERE id > \${cutoff}\`)

// Now train sees only the early 80%, test the late 20%.`}
        />
      </Section>

      <Section eyebrow="Variations" title="Things to try.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={TrendingUp} title="Multi-horizon forecasting" accent="cyan">
            Predict multiple future steps in one shot. featureShape stays [L]; target becomes a
            comma-separated 'next K values' string. ML-Labs treats it as multiple regression rows
            (one per horizon), or you can collapse to one task with K-dim output.
          </InfoCard>
          <InfoCard icon={Layers} title="Add lag features" accent="purple">
            Beyond the window itself, add hand-crafted features: rolling mean over last 24h,
            day-of-week, hour-of-day. Compute these inside <code>featurize</code>. Often a 2-3pp
            R² gain.
          </InfoCard>
          <InfoCard icon={Activity} title="Seasonality decomposition" accent="green">
            For series with strong seasonal patterns, subtract the trend + seasonal component first.
            Train ML-Labs on the residual. Reverse the decomposition at predict time. Standard
            time-series practice.
          </InfoCard>
          <InfoCard icon={TrendingUp} title="Classification on windows" accent="orange">
            Same trick, kind=classification. Window features → discrete label (e.g. "trend up" /
            "trend down" / "flat"). Useful for trading-signal-style tasks.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="When to bail" title="When MLPs aren't enough.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Long-range dependencies — events 100+ steps ago still matter (e.g. monthly seasonality on hourly data)</li>
          <li>Multiple correlated series with shared structure — proper VAR / multivariate LSTM territory</li>
          <li>Irregular timestamps — gaps require handling that windowing doesn't address</li>
          <li>Need uncertainty bands (prediction intervals) — ML-Labs returns a point estimate; bootstrapped intervals possible but manual</li>
        </ul>
        <Callout kind="learn" title="Real time-series tooling">
          For serious work: <a href="https://github.com/Nixtla/neuralforecast" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">Nixtla's neuralforecast</a>{" "}
          (LSTM, NHITS, TFT), <a href="https://facebook.github.io/prophet/" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">Prophet</a> (decomposition + Bayesian),{" "}
          <a href="https://www.statsmodels.org/" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">statsmodels</a> (ARIMA, ETS). ML-Labs's MLP-on-windows is good enough
          for ~80% of one-off forecasting work; for production pipelines, reach for those.
        </Callout>
      </Section>
    </div>
  )
}
