import { Routes, Route } from "react-router-dom"
import { Layout } from "./components/Layout"
import { Home } from "./pages/Home"
import { Install } from "./pages/Install"
import { QuickStart } from "./pages/QuickStart"
import { CliReference } from "./pages/CliReference"
import { Architecture } from "./pages/Architecture"
import { TrainingFlow } from "./pages/TrainingFlow"
import { SweepsAuto } from "./pages/SweepsAuto"
import { AutoTrainDeepDive } from "./pages/AutoTrainDeepDive"
import { SweepModes } from "./pages/SweepModes"
import { RegistryLearning } from "./pages/RegistryLearning"
import { MemoryBudget } from "./pages/MemoryBudget"
import { Validation } from "./pages/Validation"
import { LLM } from "./pages/LLM"
import { Dashboard } from "./pages/Dashboard"
import { TUI } from "./pages/TUI"
import { TrainingConfig } from "./pages/TrainingConfig"
import { Observability } from "./pages/Observability"
import { Benchmarks } from "./pages/Benchmarks"
import { ToolReference } from "./pages/ToolReference"
import { Changelog } from "./pages/Changelog"

export default function App() {
  return (
    <Layout>
      <Routes>
        {/* Getting Started */}
        <Route path="/" element={<Home />} />
        <Route path="/install" element={<Install />} />
        <Route path="/quick-start" element={<QuickStart />} />
        <Route path="/cli" element={<CliReference />} />

        {/* How It Works — core flows */}
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/training-flow" element={<TrainingFlow />} />
        <Route path="/sweeps-auto" element={<SweepsAuto />} />
        <Route path="/registry-learning" element={<RegistryLearning />} />

        {/* Deep dives */}
        <Route path="/auto-train-deep-dive" element={<AutoTrainDeepDive />} />
        <Route path="/sweep-modes" element={<SweepModes />} />
        <Route path="/memory-budget" element={<MemoryBudget />} />
        <Route path="/validation" element={<Validation />} />
        <Route path="/training-config" element={<TrainingConfig />} />
        <Route path="/observability" element={<Observability />} />

        {/* Surfaces */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tui" element={<TUI />} />
        <Route path="/llm" element={<LLM />} />

        {/* Reference */}
        <Route path="/tool-reference" element={<ToolReference />} />
        <Route path="/benchmarks" element={<Benchmarks />} />
        <Route path="/changelog" element={<Changelog />} />
      </Routes>
    </Layout>
  )
}
