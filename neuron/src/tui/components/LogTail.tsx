import React from "react"
import { Box, Text } from "ink"

interface Props {
  lines: string[]
  maxLines?: number
  color?: string
}

export function LogTail({ lines, maxLines = 12, color = "gray" }: Props) {
  const visible = lines.slice(-maxLines)
  return (
    <Box flexDirection="column">
      {visible.map((line, i) => (
        <Text key={i} color={color}>{line}</Text>
      ))}
      {visible.length === 0 && <Text color="gray" dimColor>No log output</Text>}
    </Box>
  )
}
