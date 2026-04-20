import React from "react"
import { Box, Text } from "ink"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

interface Column<T> {
  key: string
  header: string
  width: number
  render?: (row: T) => string
  color?: (row: T) => string
}

interface Props<T extends AnyRow> {
  rows: T[]
  columns: Column<T>[]
  selectedIndex?: number
  emptyMessage?: string
}

function pad(s: string, w: number): string {
  const str = s.length > w ? s.slice(0, w - 1) + "…" : s
  return str.padEnd(w)
}

export function Table<T extends AnyRow>({ rows, columns, selectedIndex, emptyMessage = "No items" }: Props<T>) {
  if (rows.length === 0) return <Text color="gray">{emptyMessage}</Text>

  return (
    <Box flexDirection="column">
      <Box>
        {columns.map((col) => (
          <Text key={col.header} bold color="cyan">{pad(col.header, col.width)}</Text>
        ))}
      </Box>
      {rows.map((row, i) => {
        const selected = i === selectedIndex
        return (
          <Box key={i}>
            {columns.map((col) => {
              const val = col.render ? col.render(row) : String(row[col.key] ?? "")
              const color = col.color?.(row) ?? (selected ? "white" : "gray")
              const prefix = col === columns[0] && selected ? "▶ " : col === columns[0] ? "  " : ""
              return <Text key={col.header} color={color}>{pad(prefix + val, col.width)}</Text>
            })}
          </Box>
        )
      })}
    </Box>
  )
}
