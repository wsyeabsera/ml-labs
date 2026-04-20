import { Routes, Route } from "react-router-dom"
import { Layout } from "./components/Layout"
import { Home } from "./pages/Home"
import { Architecture } from "./pages/Architecture"
import { TrainingFlow } from "./pages/TrainingFlow"
import { SweepsAuto } from "./pages/SweepsAuto"
import { RegistryLearning } from "./pages/RegistryLearning"
import { QuickStart } from "./pages/QuickStart"
import { ToolReference } from "./pages/ToolReference"

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/training-flow" element={<TrainingFlow />} />
        <Route path="/sweeps-auto" element={<SweepsAuto />} />
        <Route path="/registry-learning" element={<RegistryLearning />} />
        <Route path="/quick-start" element={<QuickStart />} />
        <Route path="/tool-reference" element={<ToolReference />} />
      </Routes>
    </Layout>
  )
}
