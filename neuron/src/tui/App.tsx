import React, { useState } from "react"
import { Box, Text, useInput, useApp } from "ink"
import { TabBar, type Tab } from "./components/TabBar"
import { Dashboard } from "./screens/Dashboard"
import { Dataset } from "./screens/Dataset"
import { Train } from "./screens/Train"
import { Runs } from "./screens/Runs"
import { Predict } from "./screens/Predict"
import { useStore } from "./store"

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard")
  const [showHelp, setShowHelp] = useState(false)
  const { error } = useStore()
  const { exit } = useApp()

  useInput((input) => {
    if (input === "q") exit()
    if (input === "?") setShowHelp((h) => !h)
    if (input === "1") setTab("dashboard")
    if (input === "2") setTab("dataset")
    if (input === "3") setTab("train")
    if (input === "4") setTab("runs")
    if (input === "5") setTab("predict")
  })

  function navigate(t: Tab) { setTab(t) }

  return (
    <Box flexDirection="column" height="100%">
      <TabBar active={tab} />

      {showHelp && (
        <Box flexDirection="column" borderStyle="round" paddingX={2} marginX={1}>
          <Text bold color="cyan">Keyboard shortcuts</Text>
          <Text>1-5  Switch tabs     q    Quit</Text>
          <Text>?    Toggle help     Esc  Go back</Text>
          <Text>j/k  Navigate up/down   Enter  Confirm</Text>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="column" overflowY="hidden">
        {tab === "dashboard" && <Dashboard onNavigate={navigate} />}
        {tab === "dataset"   && <Dataset />}
        {tab === "train"     && <Train />}
        {tab === "runs"      && <Runs />}
        {tab === "predict"   && <Predict />}
      </Box>

      {error && !showHelp && (
        <Box borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">⚠ {error}</Text>
        </Box>
      )}
    </Box>
  )
}
