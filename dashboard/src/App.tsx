import { BrowserRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BarChart3, PlayCircle, Zap } from "lucide-react"
import { Sidebar } from "./components/Sidebar"
import { Overview } from "./routes/Overview"
import { TaskDetail } from "./routes/Tasks"
import { Placeholder } from "./routes/Placeholder"

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 2000, retry: 1 },
  },
})

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
          <Sidebar />
          <main className="flex-1 ml-[220px] overflow-y-auto">
            <div className="max-w-5xl mx-auto px-6 py-8">
              <Routes>
                <Route path="/"               element={<Overview />} />
                <Route path="/tasks/:id"      element={<TaskDetail />} />
                <Route path="/tasks"          element={<Overview />} />
                <Route path="/runs"           element={
                  <Placeholder
                    icon={BarChart3}
                    title="Run Analytics"
                    phase="Phase 4"
                    items={[
                      "Full run history table with sortable columns",
                      "Confusion matrix heatmap",
                      "Per-class accuracy bar chart",
                      "Training curves with convergence markers",
                      "Run comparison side by side",
                    ]}
                  />
                } />
                <Route path="/train"          element={
                  <Placeholder
                    icon={PlayCircle}
                    title="Training Console"
                    phase="Phase 3"
                    items={[
                      "Start training directly from the browser",
                      "Live stage progress via SSE",
                      "Loss curve animates in on completion",
                      "Per-class accuracy breakdown",
                      "Cancel training button",
                    ]}
                  />
                } />
                <Route path="/predict"        element={
                  <Placeholder
                    icon={Zap}
                    title="Predict"
                    phase="Phase 5"
                    items={[
                      "Paste feature values and get a prediction",
                      "Confidence bar chart per class",
                      "Batch predict via CSV upload",
                    ]}
                  />
                } />
              </Routes>
            </div>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
