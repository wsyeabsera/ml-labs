import React from "react"
import { Box, Text } from "ink"

interface Props {
  value: number  // 0-1
  width?: number
  label?: string
  color?: string
}

export function ProgressBar({ value, width = 40, label, color = "cyan" }: Props) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * width)
  const empty = width - filled
  const pct = Math.round(value * 100)
  return (
    <Box gap={1}>
      <Text color={color}>{"█".repeat(filled)}{"░".repeat(empty)}</Text>
      <Text>{pct}%</Text>
      {label && <Text color="gray">{label}</Text>}
    </Box>
  )
}
