import { BrowserRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Sidebar } from "./components/Sidebar"
import { ActivityFeedProvider } from "./components/ActivityFeed"
import { AskClaude } from "./components/AskClaude"
import { Overview } from "./routes/Overview"
import { TaskDetail } from "./routes/Tasks"
import { RunDetail } from "./routes/RunDetail"
import { RunsAll } from "./routes/RunsAll"
import { Train } from "./routes/Train"
import { CompareRuns } from "./routes/CompareRuns"
import { Predict } from "./routes/Predict"
import { Sweep } from "./routes/Sweep"
import { Upload } from "./routes/Upload"

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 2000, retry: 1 },
  },
})

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ActivityFeedProvider>
        <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
          <Sidebar />
          <main className="flex-1 ml-[220px] overflow-y-auto">
            <div className="max-w-5xl mx-auto px-6 py-8">
              <Routes>
                <Route path="/"                               element={<Overview />} />
                <Route path="/tasks"                          element={<Overview />} />
                <Route path="/tasks/:id"                      element={<TaskDetail />} />
                <Route path="/tasks/:id/runs/:runId"          element={<RunDetail />} />
                <Route path="/tasks/:id/compare"             element={<CompareRuns />} />
                <Route path="/runs"                           element={<RunsAll />} />
                <Route path="/train"                           element={<Train />} />
                <Route path="/predict"                        element={<Predict />} />
                <Route path="/sweep"                          element={<Sweep />} />
                <Route path="/upload"                         element={<Upload />} />
              </Routes>
            </div>
          </main>
          <AskClaude />
        </div>
        </ActivityFeedProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
