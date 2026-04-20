import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import {
  Beaker,
  Cpu,
  GitBranch,
  Layers,
  Rocket,
  Workflow,
  Zap,
  Package,
  ArrowRight,
  Terminal,
  Sparkles,
} from "lucide-react"
import { InfoCard } from "../components/InfoCard"
import { StatRow } from "../components/StatRow"
import { CodeBlock } from "../components/CodeBlock"

export function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative mb-20">
        <div className="absolute inset-0 grid-bg opacity-40 -z-10 rounded-3xl" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative"
        >
          <div className="inline-flex items-center gap-2 chip-cyan mb-6">
            <Sparkles className="w-3 h-3" /> A Claude-native ML platform
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.05] mb-6">
            Train models that <span className="gradient-text">live in your terminal</span>.
          </h1>
          <p className="text-xl text-lab-text/80 leading-relaxed max-w-2xl mb-8">
            ML-Labs is what you get when you glue a Rust tensor engine to a Claude-driven MCP
            server and tell it to stop apologizing for being local. Train, sweep, diagnose, and
            ship — from one chat.
          </p>

          <div className="lab-panel p-4 mb-6 font-mono text-sm max-w-xl">
            <div className="text-lab-muted text-xs mb-2 uppercase tracking-widest">install</div>
            <code className="text-cyan-neon text-xs leading-relaxed break-all">
              curl -fsSL https://raw.githubusercontent.com/wsyeabsera/ml-labs/main/install.sh | bash
            </code>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/install"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-cyan-neon text-lab-bg font-semibold hover:bg-cyan-neon/90 transition-all shadow-glow hover:shadow-glow hover:scale-[1.02]"
            >
              <Rocket className="w-4 h-4" /> Get Started
            </Link>
            <Link
              to="/quick-start"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-lab-border text-lab-heading hover:border-cyan-neon/50 hover:text-cyan-neon transition-colors"
            >
              <Layers className="w-4 h-4" /> Quick Start
            </Link>
            <Link
              to="/tool-reference"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-lab-text/70 hover:text-cyan-neon transition-colors"
            >
              <Terminal className="w-4 h-4" /> 30 MCP tools <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </motion.div>
      </section>

      <StatRow
        stats={[
          { value: "30", label: "MCP tools", accent: "cyan" },
          { value: "3", label: "layer stack", accent: "purple" },
          { value: "SQLite", label: "zero ops", accent: "green" },
          { value: "100%", label: "local weights", accent: "orange" },
        ]}
      />

      {/* What is this */}
      <section className="mb-20">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-purple-neon mb-3">
          What is this, really
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-4">Three layers talking to each other.</h2>
        <p className="text-lab-text/80 leading-relaxed max-w-3xl mb-8">
          At the bottom is <strong className="text-cyan-neon">rs-tensor</strong>, a Rust tensor
          library exposed as its own MCP server — our math backbone. On top of that sits{" "}
          <strong className="text-purple-neon">Neuron</strong>, a TypeScript MCP server that
          handles tasks, samples, training, and a local model registry. And on top of{" "}
          <em>that</em> is <strong className="text-pink-neon">Claude Code</strong>, which turns
          every one of those tools into something you can ask for in plain English.
        </p>

        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={Cpu} title="rs-tensor" accent="cyan" delay={0}>
            Rust-powered MLP, CNN, autograd, attention — all exposed over MCP. The math layer. We
            never write gradients by hand.
          </InfoCard>
          <InfoCard icon={Beaker} title="Neuron MCP" accent="purple" delay={0.08}>
            30 tools for training, sweeps, diagnosis, cross-project model sharing, and active
            learning. The ML product layer.
          </InfoCard>
          <InfoCard icon={Workflow} title="Claude Code" accent="pink" delay={0.16}>
            The brain. "Train a good model for iris" triggers a coordinator sub-agent that plans,
            sweeps, diagnoses, and ships.
          </InfoCard>
        </div>
      </section>

      {/* Hello world */}
      <section className="mb-20">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-green-neon mb-3">
          Hello world
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-4">A whole ML project in one message.</h2>
        <p className="text-lab-text/80 leading-relaxed mb-2 max-w-3xl">
          You paste this into Claude Code. A minute later, you have a trained, registered iris
          classifier that can predict across terminal sessions.
        </p>

        <CodeBlock
          lang="bash"
          title="terminal"
          code={`# In Claude Code:
> /neuron-auto iris

# Behind the scenes:
#   ✓ preflight_check
#   ✓ suggest_hyperparams
#   ✓ run_sweep  (3 configs in parallel)
#   ✓ evaluate + diagnose
#   ✓ register_model
#
# Verdict: "Promoted run #42 at 97.3% accuracy. 2 waves, 48s."`}
        />
      </section>

      {/* What you can do */}
      <section className="mb-20">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-orange-neon mb-3">
          Things that are already working
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-6">Five superpowers.</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Zap} title="Parallel sweeps" accent="cyan" delay={0}>
            <code className="text-cyan-neon">run_sweep</code> spawns N Agent SDK sub-agents, each
            running one config. Wall clock ≈ one run.
          </InfoCard>
          <InfoCard icon={Sparkles} title="Auto-train coordinator" accent="purple" delay={0.06}>
            A Claude sub-agent with 11 tools and a decision log. It sweeps, narrows, diagnoses, and
            knows when to quit.
          </InfoCard>
          <InfoCard icon={Package} title="Cross-project registry" accent="pink" delay={0.12}>
            <code className="text-pink-neon">publish_model</code> pushes to{" "}
            <code>~/.neuron/registry/</code>. Any other project can <code>import_model</code> by
            URI.
          </InfoCard>
          <InfoCard icon={GitBranch} title="Active learning" accent="green" delay={0.18}>
            <code className="text-green-neon">suggest_samples</code> points at the exact rows your
            model is confused about. Collect more of <em>those</em>.
          </InfoCard>
          <InfoCard icon={Workflow} title="Cross-session predict" accent="orange" delay={0.24}>
            Kill the server, come back tomorrow,{" "}
            <code className="text-orange-neon">predict</code> still works. Weights restore lazily.
          </InfoCard>
          <InfoCard icon={Terminal} title="One config away" accent="cyan" delay={0.3}>
            Plug it into any Claude Code project via <code>.mcp.json</code>. No cloud auth, no web
            stack.
          </InfoCard>
        </div>
      </section>

      <section className="mb-12">
        <div className="lab-panel p-8 md:p-10 relative overflow-hidden">
          <div className="absolute -right-20 -top-20 w-64 h-64 bg-cyan-neon/10 rounded-full blur-3xl" />
          <div className="absolute -left-20 -bottom-20 w-64 h-64 bg-purple-neon/10 rounded-full blur-3xl" />
          <div className="relative">
            <h3 className="text-2xl md:text-3xl font-bold mb-3">Ready to train something?</h3>
            <p className="text-lab-text/80 mb-5 max-w-2xl">
              One installer, one init, one slash command. Five minutes start to finish.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/install"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/40 hover:bg-cyan-neon/25 transition-colors"
              >
                Install ML-Labs <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/training-flow"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-purple-neon/10 text-purple-neon border border-purple-neon/30 hover:bg-purple-neon/20 transition-colors"
              >
                Walk the training flow <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
