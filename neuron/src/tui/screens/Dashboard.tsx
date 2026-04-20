import React from "react"
import { Box, Text, useInput } from "ink"
import { useStore, useTaskPoller, setCurrentTask } from "../store"
import { Table } from "../components/Table"
import type { Tab } from "../components/TabBar"

interface Props {
  onNavigate: (tab: Tab, taskId?: string) => void
}

export function Dashboard({ onNavigate }: Props) {
  useTaskPoller(true)
  const { tasks, error } = useStore()

  useInput((input) => {
    if (input === "r") onNavigate("runs")
    if (input === "d") onNavigate("dataset")
    if (input === "t") onNavigate("train")
    if (input === "p") onNavigate("predict")
  })

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="cyan">Neuron — Dashboard</Text>
      {error && <Text color="red">{error}</Text>}
      <Table
        rows={tasks}
        selectedIndex={-1}
        emptyMessage="No tasks yet. Use create_task via Claude or the MCP server."
        columns={[
          { key: "id", header: "Task ID", width: 24 },
          { key: "kind", header: "Kind", width: 14 },
          { key: "normalize", header: "Norm", width: 6, render: (r) => (r as { normalize?: boolean }).normalize ? "on" : "—", color: (r) => (r as { normalize?: boolean }).normalize ? "cyan" : "gray" },
          { key: "sampleCount", header: "Samples", width: 10, render: (r) => String(r.sampleCount) },
          { key: "trained", header: "Trained", width: 10, render: (r) => r.trained ? "yes" : "no", color: (r) => r.trained ? "green" : "yellow" },
          {
            key: "accuracy", header: "Accuracy", width: 10,
            render: (r) => r.accuracy != null ? `${((r.accuracy as number) * 100).toFixed(1)}%` : "—",
            color: (r) => r.accuracy != null && (r.accuracy as number) >= 0.9 ? "green" : r.accuracy != null ? "yellow" : "gray",
          },
          { key: "activeRunId", header: "Active Run", width: 12, render: (r) => r.activeRunId ? `#${r.activeRunId} ⏳` : "—", color: (r) => r.activeRunId ? "cyan" : "gray" },
        ]}
      />
      <Text color="gray" dimColor>t=Train  d=Dataset  r=Runs  p=Predict</Text>
    </Box>
  )
}
