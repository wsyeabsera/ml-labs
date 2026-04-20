import React from "react"
import { Box, Text } from "ink"

export type Tab = "dashboard" | "dataset" | "train" | "runs" | "predict"

const TABS: { key: Tab; label: string; shortcut: string }[] = [
  { key: "dashboard", label: "Dashboard", shortcut: "1" },
  { key: "dataset",   label: "Dataset",   shortcut: "2" },
  { key: "train",     label: "Train",     shortcut: "3" },
  { key: "runs",      label: "Runs",      shortcut: "4" },
  { key: "predict",   label: "Predict",   shortcut: "5" },
]

export function TabBar({ active }: { active: Tab }) {
  return (
    <Box borderStyle="single" borderBottom={false} paddingX={1} gap={2}>
      {TABS.map((t) => (
        <Box key={t.key} gap={0}>
          <Text color="gray">[{t.shortcut}]</Text>
          <Text> </Text>
          <Text
            color={active === t.key ? "cyan" : "white"}
            bold={active === t.key}
            underline={active === t.key}
          >
            {t.label}
          </Text>
        </Box>
      ))}
      <Box flexGrow={1} />
      <Text color="gray">q=quit  ?=help</Text>
    </Box>
  )
}
