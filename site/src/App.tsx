import { Routes, Route } from "react-router-dom"
import { Layout } from "./components/Layout"
import { Home } from "./pages/Home"
import { Install } from "./pages/Install"
import { QuickStart } from "./pages/QuickStart"
import { CliReference } from "./pages/CliReference"
import { Architecture } from "./pages/Architecture"
import { TrainingFlow } from "./pages/TrainingFlow"
import { SweepsAuto } from "./pages/SweepsAuto"
import { RegistryLearning } from "./pages/RegistryLearning"
import { ToolReference } from "./pages/ToolReference"
import { Changelog } from "./pages/Changelog"

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/install" element={<Install />} />
        <Route path="/quick-start" element={<QuickStart />} />
        <Route path="/cli" element={<CliReference />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/training-flow" element={<TrainingFlow />} />
        <Route path="/sweeps-auto" element={<SweepsAuto />} />
        <Route path="/registry-learning" element={<RegistryLearning />} />
        <Route path="/tool-reference" element={<ToolReference />} />
        <Route path="/changelog" element={<Changelog />} />
      </Routes>
    </Layout>
  )
}
