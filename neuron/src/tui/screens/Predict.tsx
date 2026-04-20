import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { useStore, useTaskPoller, setCurrentTask } from "../store"
import { neuron, type PredictResult } from "../client/mcp"

export function Predict() {
  useTaskPoller(true)
  const { tasks } = useStore()
  const [taskIdx, setTaskIdx] = useState(0)
  const [phase, setPhase] = useState<"pick" | "input" | "result">("pick")
  const [input, setInput] = useState("")
  const [result, setResult] = useState<PredictResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const task = tasks[taskIdx]

  useInput((ch, key) => {
    if (phase === "pick") {
      if (ch === "j" || key.downArrow) setTaskIdx((i) => Math.min(tasks.length - 1, i + 1))
      if (ch === "k" || key.upArrow) setTaskIdx((i) => Math.max(0, i - 1))
      if (key.return && task) { setCurrentTask(task.id); setPhase("input") }
    } else if (phase === "input") {
      if (key.escape) { setPhase("pick"); setInput(""); setResult(null); setError(null) }
      if (key.backspace || key.delete) setInput((v) => v.slice(0, -1))
      else if (ch && /[\d.,\- ]/.test(ch)) setInput((v) => v + ch)
      if (key.return && input.trim()) {
        const features = input.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n))
        if (features.length === 0) { setError("No valid numbers found — enter comma-separated values like: 0.1, 0.5, 1.0"); return }
        setLoading(true)
        setError(null)
        neuron.predict(task!.id, features).then((r) => {
          setResult(r)
          setLoading(false)
          setPhase("result")
        }).catch((e) => {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        })
      }
    } else if (phase === "result") {
      if (key.return || key.escape) { setPhase("input"); setResult(null); setInput("") }
    }
  })

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="cyan">Predict</Text>

      {phase === "pick" && (
        <Box flexDirection="column" gap={1}>
          <Text>Select a task (j/k, Enter):</Text>
          {tasks.map((t, i) => (
            <Text key={t.id} color={i === taskIdx ? "cyan" : "gray"} bold={i === taskIdx}>
              {i === taskIdx ? "▶ " : "  "}{t.id}
              <Text color="gray">  feature dim: {t.featureShape[0] ?? "?"}</Text>
            </Text>
          ))}
          {tasks.length === 0 && <Text color="gray">No tasks.</Text>}
        </Box>
      )}

      {(phase === "input" || phase === "result") && task && (
        <Box flexDirection="column" gap={1}>
          <Text>Task: <Text color="cyan">{task.id}</Text>  (D={task.featureShape[0] ?? "?"})</Text>
          <Box gap={1}>
            <Text color="cyan">Features:</Text>
            <Text>{input}{phase === "input" ? "▌" : ""}</Text>
          </Box>
          <Text color="gray" dimColor>Enter comma-separated numbers  Enter=predict  Esc=back</Text>
          {loading && <Text color="yellow">Predicting…</Text>}
          {error && <Text color="red">{error}</Text>}
        </Box>
      )}

      {phase === "result" && result && (
        <Box flexDirection="column" gap={1} borderStyle="single" paddingX={1}>
          <Text bold>Prediction: <Text color="green">{result.label}</Text>  ({(result.confidence * 100).toFixed(1)}% confidence)</Text>
          <Box flexDirection="column">
            {Object.entries(result.scores)
              .sort(([, a], [, b]) => b - a)
              .map(([l, s]) => (
                <Box key={l} gap={2}>
                  <Text color={l === result.label ? "green" : "gray"}>{l.padEnd(12)}</Text>
                  <Text color="cyan">{"█".repeat(Math.round(s * 20))}{"░".repeat(20 - Math.round(s * 20))}</Text>
                  <Text color="gray">{(s * 100).toFixed(1)}%</Text>
                </Box>
              ))
            }
          </Box>
          <Text color="gray" dimColor>Enter or Esc to predict again</Text>
        </Box>
      )}
    </Box>
  )
}
