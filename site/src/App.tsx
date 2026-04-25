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

// New v1.11 batch
import { Glossary } from "./pages/Glossary"
import { EnvVars } from "./pages/EnvVars"
import { SlashCommands } from "./pages/SlashCommands"
import { AdapterReference } from "./pages/AdapterReference"
import { DBSchema } from "./pages/DBSchema"
import { HttpApiReference } from "./pages/HttpApiReference"
import { SamplingFallback } from "./pages/SamplingFallback"
import { Troubleshooting } from "./pages/Troubleshooting"
import { Cookbook } from "./pages/Cookbook"
import { Tutorial } from "./pages/Tutorial"
import { ML101 } from "./pages/ML101"
import { MentalModel } from "./pages/MentalModel"
import { AntiPatterns } from "./pages/AntiPatterns"
import { BuildTrainer } from "./pages/BuildTrainer"
import { Story } from "./pages/Story"
import { Performance } from "./pages/Performance"
import { DBTour } from "./pages/DBTour"
import { NonClaudeUsage } from "./pages/NonClaudeUsage"
import { ADRs } from "./pages/ADRs"
import { Postmortems } from "./pages/Postmortems"
import { ImageClassification } from "./pages/ImageClassification"
import { TimeSeries } from "./pages/TimeSeries"
import { NLPWorkflows } from "./pages/NLPWorkflows"
import { MultiTask } from "./pages/MultiTask"
import { InsideSubagent } from "./pages/InsideSubagent"
import { TPEExplained } from "./pages/TPEExplained"
import { CalibrationMath } from "./pages/CalibrationMath"
import { RsTensorInternals } from "./pages/RsTensorInternals"
import { WhyMCP } from "./pages/WhyMCP"
import { Comparisons } from "./pages/Comparisons"

export default function App() {
  return (
    <Layout>
      <Routes>
        {/* Getting Started */}
        <Route path="/" element={<Home />} />
        <Route path="/install" element={<Install />} />
        <Route path="/quick-start" element={<QuickStart />} />
        <Route path="/tutorial" element={<Tutorial />} />
        <Route path="/ml-101" element={<ML101 />} />
        <Route path="/mental-model" element={<MentalModel />} />
        <Route path="/cli" element={<CliReference />} />

        {/* How It Works */}
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/training-flow" element={<TrainingFlow />} />
        <Route path="/sweeps-auto" element={<SweepsAuto />} />
        <Route path="/registry-learning" element={<RegistryLearning />} />

        {/* Deep Dives */}
        <Route path="/auto-train-deep-dive" element={<AutoTrainDeepDive />} />
        <Route path="/sweep-modes" element={<SweepModes />} />
        <Route path="/memory-budget" element={<MemoryBudget />} />
        <Route path="/validation" element={<Validation />} />
        <Route path="/training-config" element={<TrainingConfig />} />
        <Route path="/observability" element={<Observability />} />
        <Route path="/sampling-fallback" element={<SamplingFallback />} />

        {/* Cookbook & Specialty */}
        <Route path="/cookbook" element={<Cookbook />} />
        <Route path="/anti-patterns" element={<AntiPatterns />} />
        <Route path="/image-classification" element={<ImageClassification />} />
        <Route path="/time-series" element={<TimeSeries />} />
        <Route path="/nlp-workflows" element={<NLPWorkflows />} />
        <Route path="/multi-task" element={<MultiTask />} />

        {/* Surfaces */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tui" element={<TUI />} />
        <Route path="/llm" element={<LLM />} />
        <Route path="/non-claude-usage" element={<NonClaudeUsage />} />

        {/* Inside the engine */}
        <Route path="/build-trainer" element={<BuildTrainer />} />
        <Route path="/inside-subagent" element={<InsideSubagent />} />
        <Route path="/tpe-explained" element={<TPEExplained />} />
        <Route path="/calibration-math" element={<CalibrationMath />} />
        <Route path="/rs-tensor-internals" element={<RsTensorInternals />} />
        <Route path="/why-mcp" element={<WhyMCP />} />
        <Route path="/db-tour" element={<DBTour />} />

        {/* Project context */}
        <Route path="/story" element={<Story />} />
        <Route path="/adrs" element={<ADRs />} />
        <Route path="/postmortems" element={<Postmortems />} />
        <Route path="/comparisons" element={<Comparisons />} />
        <Route path="/performance" element={<Performance />} />

        {/* Reference */}
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/troubleshooting" element={<Troubleshooting />} />
        <Route path="/tool-reference" element={<ToolReference />} />
        <Route path="/slash-commands" element={<SlashCommands />} />
        <Route path="/env-vars" element={<EnvVars />} />
        <Route path="/adapter-reference" element={<AdapterReference />} />
        <Route path="/db-schema" element={<DBSchema />} />
        <Route path="/http-api-reference" element={<HttpApiReference />} />
        <Route path="/benchmarks" element={<Benchmarks />} />
        <Route path="/changelog" element={<Changelog />} />
      </Routes>
    </Layout>
  )
}
