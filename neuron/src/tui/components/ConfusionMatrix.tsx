import React from "react"
import { Box, Text } from "ink"

interface Props {
  matrix: number[][]
  labels: string[]
}

export function ConfusionMatrix({ matrix, labels }: Props) {
  if (!matrix.length || !labels.length) return <Text color="gray">No confusion matrix data</Text>

  const colWidth = Math.max(6, ...labels.map((l) => l.length + 1))
  const labelWidth = Math.max(8, ...labels.map((l) => l.length + 1))

  const fmt = (s: string | number, w: number) => String(s).padStart(w)

  return (
    <Box flexDirection="column">
      <Text color="gray">Confusion matrix (rows=true, cols=predicted):</Text>
      <Box>
        <Text>{" ".repeat(labelWidth)}</Text>
        {labels.map((l) => <Text key={l} color="cyan">{fmt(l, colWidth)}</Text>)}
      </Box>
      {matrix.map((row, i) => (
        <Box key={i}>
          <Text color="cyan">{fmt(labels[i] ?? String(i), labelWidth)}</Text>
          {row.map((v, j) => (
            <Text key={j} color={i === j ? "green" : v > 0 ? "red" : "gray"}>
              {fmt(v, colWidth)}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
