import { Gauge, HardDrive, Cpu, Zap } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Table } from "../components/Table"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"

export function Performance() {
  return (
    <div>
      <PageHeader
        eyebrow="Realistic capacity planning"
        accent="green"
        title={<><span className="gradient-text">Performance</span> characteristics.</>}
        lede="Wall-clock and memory measurements for various workloads on representative hardware. Use these to plan: 'will this run in coffee-break time, lunch-break time, or overnight?' Numbers are from internal benchmarks; YMMV depending on hardware, OS, background load."
      />

      <Section eyebrow="The headline numbers" title="Five datasets, three machines.">
        <Table
          caption="auto_train (default settings) — wall-clock seconds, hot run"
          columns={[
            { key: "dataset", header: "Dataset",         accent: "cyan" },
            { key: "shape",   header: "N × D",           mono: true },
            { key: "k",       header: "K",               mono: true },
            { key: "m1",      header: "M1 Pro",          mono: true, accent: "green" },
            { key: "m3",      header: "M3 Max",          mono: true, accent: "green" },
            { key: "intel",   header: "Intel i7 (2020)", mono: true, accent: "orange" },
          ]}
          rows={[
            { dataset: "iris",          shape: "150×4",       k: "3",  m1: "4s",   m3: "3s",   intel: "8s"   },
            { dataset: "wine",          shape: "178×13",      k: "3",  m1: "5s",   m3: "3s",   intel: "10s"  },
            { dataset: "breast-cancer", shape: "569×30",      k: "2",  m1: "10s",  m3: "7s",   intel: "22s"  },
            { dataset: "digits",        shape: "1797×64",     k: "10", m1: "38s",  m3: "26s",  intel: "85s"  },
            { dataset: "housing",       shape: "506×13",      k: "1",  m1: "17s",  m3: "12s",  intel: "40s"  },
            { dataset: "Fashion-MNIST", shape: "60k×784",     k: "10", m1: "6m",   m3: "4m",   intel: "14m"  },
          ]}
        />
        <Callout kind="note">
          Times are <em>per auto_train invocation</em> (preflight + 2 waves + diagnose + promote +
          calibrate). Hot run = repeated invocation; cold (first time after server start) adds ~3-5s
          for rs-tensor child-process boot.
        </Callout>
      </Section>

      <Section eyebrow="Memory" title="Peak resident set size.">
        <Table
          caption="Peak RSS at the heaviest moment of the workload"
          columns={[
            { key: "dataset",  header: "Dataset",       accent: "cyan" },
            { key: "level",    header: "Budget level" },
            { key: "host",     header: "Host (Bun) RSS",  mono: true },
            { key: "rstensor", header: "rs-tensor RSS",   mono: true },
            { key: "total",    header: "Total",          mono: true, accent: "orange" },
          ]}
          rows={[
            { dataset: "iris",          level: "safe",     host: "180 MB", rstensor: "60 MB",   total: "~240 MB" },
            { dataset: "wine",          level: "safe",     host: "190 MB", rstensor: "65 MB",   total: "~255 MB" },
            { dataset: "digits",        level: "safe",     host: "230 MB", rstensor: "120 MB",  total: "~350 MB" },
            { dataset: "Fashion-MNIST (sequential)", level: "heavy", host: "850 MB", rstensor: "320 MB",  total: "~1.2 GB" },
            { dataset: "Fashion-MNIST (3× sub-agent)", level: "heavy override", host: "850 MB × 1 + 600 MB × 3", rstensor: "320 MB × 3", total: "~3.6 GB" },
            { dataset: "Fashion-MNIST + augmentations (60M+ cells)", level: "refuse", host: "—", rstensor: "—", total: "~6 GB+ (will OOM 8GB hosts)" },
          ]}
        />
        <Callout kind="learn" title="Why the gap between sequential and sub-agents">
          In sequential mode, only one training is in flight at a time — the input tensor exists
          once. In sub-agent mode, 3 sub-agents each load their own copy. With Fashion-MNIST that
          difference is huge (3.6 GB vs 1.2 GB). Hence the v1.7.0 default flip + v1.8.1 adaptive
          switch.
        </Callout>
      </Section>

      <Section eyebrow="Per-epoch cost" title="What dominates training time.">
        <Table
          caption="Time per epoch for a 2-layer MLP (1 hidden, ~32 wide)"
          columns={[
            { key: "shape",   header: "N × D",   mono: true, accent: "cyan" },
            { key: "m1",      header: "M1 Pro",  mono: true },
            { key: "m3",      header: "M3 Max",  mono: true },
            { key: "intel",   header: "Intel i7", mono: true },
          ]}
          rows={[
            { shape: "150 × 4",     m1: "0.8 ms",  m3: "0.5 ms",  intel: "1.8 ms"  },
            { shape: "1k × 30",     m1: "8 ms",    m3: "5 ms",    intel: "20 ms"   },
            { shape: "10k × 100",   m1: "120 ms",  m3: "80 ms",   intel: "300 ms"  },
            { shape: "60k × 784",   m1: "2.8 s",   m3: "1.9 s",   intel: "8 s"     },
          ]}
        />
        <Callout kind="learn" title="Where the time goes">
          For small data (&lt;1k samples), MCP overhead (JSON serialization across the stdio pipe to
          rs-tensor) dominates — actual math is microseconds. For large data, math dominates. The
          crossover is around 5k×50.
        </Callout>
      </Section>

      <Section eyebrow="Sweep parallelism" title="When does parallel pay off.">
        <Table
          caption="3 configs, sweep wall-clock"
          columns={[
            { key: "shape",      header: "N × D",            mono: true, accent: "cyan" },
            { key: "seq",        header: "Sequential",       mono: true },
            { key: "subagent",   header: "Sub-agents",       mono: true },
            { key: "speedup",    header: "Speedup",          mono: true, accent: "green" },
          ]}
          rows={[
            { shape: "150 × 4",      seq: "12s",   subagent: "8s",   speedup: "1.5×"  },
            { shape: "1k × 30",      seq: "30s",   subagent: "15s",  speedup: "2.0×"  },
            { shape: "10k × 100",    seq: "120s",  subagent: "55s",  speedup: "2.2×"  },
            { shape: "60k × 784",    seq: "9m",    subagent: "OOM",  speedup: "—"     },
          ]}
        />
        <Callout kind="tip">
          Parallel sweep speedup never reaches 3× (the theoretical max with 3 sub-agents) because of
          sub-agent boot time (~1.5s each) + shared CPU contention. ~2× is the realistic ceiling on
          a 4-core laptop.
        </Callout>
      </Section>

      <Section eyebrow="LLM inference" title="GGUF inference speed.">
        <Table
          caption="Tokens/second on llm_generate, max_tokens=64"
          columns={[
            { key: "model", header: "Model",         accent: "purple" },
            { key: "quant", header: "Quantization",  mono: true },
            { key: "m1",    header: "M1 Pro",        mono: true },
            { key: "m3",    header: "M3 Max",        mono: true },
            { key: "intel", header: "Intel i7",      mono: true },
          ]}
          rows={[
            { model: "TinyLlama 1.1B",   quant: "Q4_K_M", m1: "8 t/s",   m3: "12 t/s",  intel: "4 t/s"   },
            { model: "TinyLlama 1.1B",   quant: "Q8_0",   m1: "5 t/s",   m3: "8 t/s",   intel: "2.5 t/s" },
            { model: "Phi-2 2.7B",       quant: "Q4_K_M", m1: "4 t/s",   m3: "6 t/s",   intel: "1.8 t/s" },
            { model: "Mistral 7B",       quant: "Q4_K_M", m1: "1.5 t/s", m3: "2.5 t/s", intel: "0.6 t/s" },
          ]}
        />
        <Callout kind="warn" title="LLM inference is CPU-only">
          rs-tensor doesn't have GPU support. These rates are realistic but slow vs cloud APIs. Use
          for pipeline steps and prototypes; never for interactive chat.
        </Callout>
      </Section>

      <Section eyebrow="DB throughput" title="When SQLite becomes the bottleneck.">
        <Table
          caption="SQLite ops/sec on the project DB (single connection, WAL mode)"
          columns={[
            { key: "op",    header: "Operation",            accent: "cyan" },
            { key: "ops",   header: "Ops/sec",              mono: true },
          ]}
          rows={[
            { op: "Insert one sample",                                   ops: "~5,000" },
            { op: "Insert 500-row batch (load_csv chunk)",                ops: "~3,000 batches/sec → ~1.5M rows/sec" },
            { op: "Read one run row",                                     ops: "~50,000" },
            { op: "Read events stream (1000 events)",                     ops: "~8,000 reads/sec" },
            { op: "Insert one prediction (predict log)",                  ops: "~7,000" },
          ]}
        />
        <Callout kind="learn" title="When this matters">
          For single-user / single-laptop workloads, never. The bottleneck is always math. If you're
          driving 10k+ predict requests/sec from a script, drop the prediction sample rate via{" "}
          <code>NEURON_PREDICTION_SAMPLE_RATE=0.1</code>.
        </Callout>
      </Section>

      <Section eyebrow="Practical guidance" title="Capacity planning rules of thumb.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Zap} title="Coffee-break workloads" accent="cyan">
            Anything under 5M input cells. Iris, wine, breast-cancer, digits, housing. Run inline
            during a meeting. Sub-agent sweep mode pays off here.
          </InfoCard>
          <InfoCard icon={Gauge} title="Lunch-break workloads" accent="purple">
            5M – 20M input cells. Big tabular (~10k samples × 100 features), small image. Plan ~1-4
            min per wave; an auto_train completes in a single lunch if the target is reasonable.
          </InfoCard>
          <InfoCard icon={Cpu} title="Overnight workloads" accent="orange">
            20M – 60M input cells. Fashion-MNIST scale. Plan 30+ min for a full auto_train. Sequential
            sweep mode auto-selected. Run before bed; check verdict in the morning.
          </InfoCard>
          <InfoCard icon={HardDrive} title="Don't workloads" accent="pink">
            ≥60M input cells (refuse band). Subset first and iterate on the subset. If you really
            need the full thing, do one final training with the winning config — but on a beefier
            machine, or accept ~1hr+ wall-clock and ~5GB+ RSS on a laptop.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reproducing these numbers" title="Run it yourself.">
        <CodeBlock
          lang="bash"
          title="Benchmark on your hardware"
          code={`# Full bench suite (all 5 datasets), deterministic
bun run bench

# Just iris + wine for a quick check
bun run bench:fast

# The benchmarks deliberately use:
#   NEURON_PLANNER=rules
#   NEURON_SWEEP_MODE=sequential
#   NEURON_SEED=42
# So your numbers should be identical across hardware (same loss curves)
# but different in WALL-CLOCK by your CPU's speed.`}
        />
        <Callout kind="tip">
          If your numbers are dramatically off, check: thermal throttling, background load, swap.
          M-series Macs run with little throttling on small workloads but throttle on the
          Fashion-MNIST scale runs if cooling is poor.
        </Callout>
      </Section>
    </div>
  )
}
