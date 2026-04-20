import React, { useState, useEffect, useRef } from "react"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"
import { useStore, useTaskPoller, useRunPoller, startTrain } from "../store"
import { neuron } from "../client/mcp"
import { ProgressBar } from "../components/ProgressBar"
import { LossChart } from "../components/LossChart"

type TrainState = "pick" | "config" | "training" | "done" | "error"

export function Train() {
  useTaskPoller(true)
  const { tasks, activeRunStatus, error } = useStore()
  const [trainState, setTrainState] = useState<TrainState>("pick")
  const [taskIdx, setTaskIdx] = useState(0)
  const [lr, setLr] = useState("0.005")
  const [epochs, setEpochs] = useState("500")
  const [fieldIdx, setFieldIdx] = useState(0)
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [result, setResult] = useState<{ accuracy: number; runId: number } | null>(null)
  const [trainError, setTrainError] = useState<string | null>(null)
  const trainPromise = useRef<Promise<unknown> | null>(null)

  useRunPoller(activeRunId)

  const task = tasks[taskIdx]
  const fields = [{ label: "lr", value: lr, set: setLr }, { label: "epochs", value: epochs, set: setEpochs }]

  useInput((input, key) => {
    if (trainState === "pick") {
      if (input === "j" || key.downArrow) setTaskIdx((i) => Math.min(tasks.length - 1, i + 1))
      if (input === "k" || key.upArrow) setTaskIdx((i) => Math.max(0, i - 1))
      if (key.return && task) {
        // suggest defaults
        neuron.suggestHyperparams(task.id).then((s) => {
          setLr(String(s.lr))
          setEpochs(String(s.epochs))
        }).catch(() => {})
        setTrainState("config")
      }
    } else if (trainState === "config") {
      if (input === "j" || key.downArrow) setFieldIdx((i) => (i + 1) % fields.length)
      if (input === "k" || key.upArrow) setFieldIdx((i) => (i - 1 + fields.length) % fields.length)
      if (key.backspace || key.delete) {
        const f = fields[fieldIdx]
        if (f) f.set((v) => v.slice(0, -1))
      } else if (input && /[\d.]/.test(input)) {
        const f = fields[fieldIdx]
        if (f) f.set((v) => v + input)
      }
      if (key.escape) setTrainState("pick")
      if (key.return) {
        setTrainState("training")
        setTrainError(null)
        trainPromise.current = startTrain(task!.id, {
          lr: parseFloat(lr) || 0.005,
          epochs: parseInt(epochs) || 500,
        }).then((r) => {
          if (r) {
            setResult({ accuracy: r.accuracy, runId: r.run_id })
            setActiveRunId(null)
            setTrainState("done")
          } else {
            setTrainError("Training failed or cancelled")
            setTrainState("error")
          }
        })
        // Kick off status polling using the most recent run
        setTimeout(() => {
          // activeRunId is set by the server; we don't know it yet without a list_runs call
          // The store will poll once the train result returns — this is a limitation of pull-based polling
        }, 100)
      }
    } else if (trainState === "done" || trainState === "error") {
      if (key.return || input === "r") {
        setTrainState("pick")
        setResult(null)
        setTrainError(null)
        setActiveRunId(null)
      }
    }
  })

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="cyan">Train</Text>

      {trainState === "pick" && (
        <Box flexDirection="column" gap={1}>
          <Text>Select a task to train (j/k to navigate, Enter to select):</Text>
          {tasks.map((t, i) => (
            <Text key={t.id} color={i === taskIdx ? "cyan" : "gray"} bold={i === taskIdx}>
              {i === taskIdx ? "▶ " : "  "}{t.id}
              {"  "}
              <Text color="gray">({t.sampleCount} samples{t.trained ? `, last acc: ${((t.accuracy ?? 0) * 100).toFixed(1)}%` : ", not trained"})</Text>
            </Text>
          ))}
          {tasks.length === 0 && <Text color="gray">No tasks. Create one via Claude Code first.</Text>}
        </Box>
      )}

      {trainState === "config" && task && (
        <Box flexDirection="column" gap={1}>
          <Text>Task: <Text color="cyan">{task.id}</Text>  ({task.sampleCount} samples)</Text>
          {fields.map((f, i) => (
            <Box key={f.label} gap={2}>
              <Text color={i === fieldIdx ? "cyan" : "white"}>{f.label.padEnd(8)}</Text>
              <Text color={i === fieldIdx ? "cyan" : "gray"}>{f.value}{i === fieldIdx ? "▌" : ""}</Text>
            </Box>
          ))}
          <Text color="gray" dimColor>j/k=field  type to edit  Enter=start  Esc=back</Text>
        </Box>
      )}

      {trainState === "training" && (
        <Box flexDirection="column" gap={1}>
          <Box gap={2}>
            <Text color="green"><Spinner type="dots" /></Text>
            <Text>Training {task?.id ?? ""}…</Text>
          </Box>
          {activeRunStatus && (
            <>
              <Text color="gray">{activeRunStatus.message}</Text>
              {activeRunStatus.stage === "featurize" && activeRunStatus.n && (
                <ProgressBar value={(activeRunStatus.i ?? 0) / activeRunStatus.n} label="featurizing" />
              )}
              {activeRunStatus.loss_history.length > 0 && (
                <LossChart lossHistory={activeRunStatus.loss_history} height={6} />
              )}
            </>
          )}
          {!activeRunStatus && <Text color="gray">Waiting for training to start…</Text>}
        </Box>
      )}

      {trainState === "done" && result && (
        <Box flexDirection="column" gap={1}>
          <Text color="green">✓ Training complete! Run #{result.runId}</Text>
          <Text>Accuracy: <Text color="green" bold>{(result.accuracy * 100).toFixed(1)}%</Text></Text>
          <Text color="gray" dimColor>Press Enter or r to train again</Text>
        </Box>
      )}

      {trainState === "error" && (
        <Box flexDirection="column" gap={1}>
          <Text color="red">✗ {trainError ?? error ?? "Unknown error"}</Text>
          <Text color="gray" dimColor>Press Enter to go back</Text>
        </Box>
      )}
    </Box>
  )
}
