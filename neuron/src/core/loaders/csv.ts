import { parse } from "csv-parse/sync"
import { readFileSync } from "node:fs"

export interface CsvRow {
  features: number[]
  label: string
}

export interface CsvLoadResult {
  rows: CsvRow[]
  errors: string[]
}

export function loadCsv(opts: {
  path: string
  featureColumns: string[] | "all"
  labelColumn: string
  hasHeader?: boolean
  expectedDim?: number
}): CsvLoadResult {
  const { path, featureColumns, labelColumn, hasHeader = true, expectedDim } = opts

  const raw = readFileSync(path, "utf-8")
  const records = parse(raw, {
    columns: hasHeader ? true : false,
    skip_empty_lines: true,
    trim: true,
    cast: false,
  }) as Record<string, string>[]

  const errors: string[] = []
  const rows: CsvRow[] = []

  for (let i = 0; i < records.length; i++) {
    const row = records[i]!
    const lineNum = hasHeader ? i + 2 : i + 1

    if (!(labelColumn in row)) {
      errors.push(`Row ${lineNum}: missing label column "${labelColumn}"`)
      continue
    }
    const label = row[labelColumn]!.trim()
    if (!label) {
      errors.push(`Row ${lineNum}: empty label`)
      continue
    }

    const colNames = featureColumns === "all"
      ? Object.keys(row).filter((k) => k !== labelColumn)
      : featureColumns

    const features: number[] = []
    let rowHasError = false
    for (const col of colNames) {
      if (!(col in row)) {
        errors.push(`Row ${lineNum}: missing feature column "${col}"`)
        rowHasError = true
        break
      }
      const val = parseFloat(row[col]!)
      if (isNaN(val)) {
        errors.push(`Row ${lineNum}: non-numeric value "${row[col]}" in column "${col}"`)
        rowHasError = true
        break
      }
      features.push(val)
    }
    if (rowHasError) continue

    if (expectedDim !== undefined && features.length !== expectedDim) {
      errors.push(`Row ${lineNum}: expected ${expectedDim} features, got ${features.length}`)
      continue
    }

    rows.push({ features, label })
  }

  return { rows, errors }
}
