import React from "react"
import { Box, Text } from "ink"
// @ts-expect-error — no types for asciichart
import asciichart from "asciichart"

interface Props {
  lossHistory: number[]
  height?: number
  width?: number
}

function downsample(arr: number[], maxPoints: number): number[] {
  if (arr.length <= maxPoints) return arr
  const result: number[] = []
  const bucketSize = arr.length / maxPoints
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize)
    const end = Math.floor((i + 1) * bucketSize)
    const bucket = arr.slice(start, end)
    result.push(bucket.reduce((a, b) => a + b, 0) / bucket.length)
  }
  return result
}

export function LossChart({ lossHistory, height = 8, width = 60 }: Props) {
  if (lossHistory.length < 2) {
    return (
      <Box height={height} alignItems="center" justifyContent="center">
        <Text color="gray">No loss data yet</Text>
      </Box>
    )
  }

  const data = downsample(lossHistory, width)
  const chart = asciichart.plot(data, { height, colors: [asciichart.blue] }) as string

  return (
    <Box flexDirection="column">
      <Text>{chart}</Text>
      <Text color="gray">
        {" "}loss: {lossHistory[0]?.toFixed(4) ?? "?"} → {lossHistory.at(-1)?.toFixed(4) ?? "?"}
        {"  "}epochs: {lossHistory.length}
      </Text>
    </Box>
  )
}
