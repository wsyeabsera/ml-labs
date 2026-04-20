import { useState, useRef } from "react"
import { Link } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  Upload as UploadIcon, ChevronRight, ArrowLeft, CheckCircle2,
  AlertCircle, Loader2, FileText, PlayCircle,
} from "lucide-react"
import { api, type ApiUploadResult } from "../lib/api"
import { clsx } from "clsx"

// ── Simple client-side CSV preview parser ──────────────────────────────────────

function parsePreview(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const splitLine = (l: string) =>
    l.split(",").map((v) => v.trim().replace(/^"(.*)"$/, "$1"))
  const headers = splitLine(lines[0]!)
  const rows = lines.slice(1, 9).map(splitLine)
  return { headers, rows }
}

// ── Shared input style ─────────────────────────────────────────────────────────

const inputCls = clsx(
  "text-sm px-3 py-2 rounded-md border outline-none transition-colors w-full",
  "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
  "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
  "placeholder:text-[var(--text-3)]",
)

// ── Preview table ──────────────────────────────────────────────────────────────

function PreviewTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-auto max-h-52">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] sticky top-0 bg-[var(--surface-1)]">
              {headers.map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[var(--text-3)] font-semibold whitespace-nowrap font-mono">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border-subtle)]">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 font-mono text-[var(--text-2)] whitespace-nowrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Step 1: Drop ───────────────────────────────────────────────────────────────

function StepDrop({ onParsed }: { onParsed: (csv: string, filename: string) => void }) {
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][]; csv: string; filename: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function processText(text: string, filename: string) {
    const p = parsePreview(text)
    if (p.headers.length === 0) return
    setPreview({ ...p, csv: text, filename })
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => processText(e.target?.result as string ?? "", file.name.replace(/\.csv$/i, ""))
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
        onClick={() => fileInputRef.current?.click()}
        className={clsx(
          "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent-dim)]"
            : "border-[var(--border)] hover:border-[var(--accent-border)] hover:bg-[var(--surface-2)]"
        )}
      >
        <input type="file" accept=".csv,text/csv,text/plain" ref={fileInputRef} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
        <FileText size={28} className="mx-auto mb-3 text-[var(--text-3)]" />
        <p className="text-sm text-[var(--text-2)] mb-1">Drop a CSV file here or <span className="text-[var(--accent-text)] underline">browse</span></p>
        <p className="text-xs text-[var(--text-3)]">First row must be a header row</p>
      </div>

      {/* Or paste */}
      {!preview && (
        <div>
          <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">Or paste CSV</label>
          <textarea
            className={clsx(inputCls, "font-mono text-xs resize-y min-h-[80px]")}
            placeholder={"sepal_len,sepal_wid,petal_len,species\n5.1,3.5,1.4,setosa\n..."}
            spellCheck={false}
            onChange={(e) => { if (e.target.value.includes(",")) processText(e.target.value, "uploaded") }}
          />
        </div>
      )}

      {/* Preview */}
      {preview && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-2)]">
              <span className="text-[var(--text-1)] font-medium">{preview.headers.length}</span> columns detected
            </p>
            <button onClick={() => setPreview(null)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)]">
              ← change file
            </button>
          </div>
          <PreviewTable headers={preview.headers} rows={preview.rows} />
          <button
            onClick={() => onParsed(preview.csv, preview.filename)}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            Configure <ChevronRight size={14} />
          </button>
        </motion.div>
      )}
    </div>
  )
}

// ── Step 2: Configure ──────────────────────────────────────────────────────────

interface Config {
  taskId: string
  kind: "classification" | "regression"
  labelCol: string
  featureCols: string[]
  normalize: boolean
  testSize: number
  replace: boolean
}

function StepConfigure({
  csv, headers, rows, initialFilename, onBack, onSubmit,
}: {
  csv: string
  headers: string[]
  rows: string[][]
  initialFilename: string
  onBack: () => void
  onSubmit: (cfg: Config) => Promise<void>
}) {
  const [taskId, setTaskId] = useState(initialFilename.replace(/[^a-z0-9_-]/gi, "-").toLowerCase() || "my-dataset")
  const [kind, setKind] = useState<"classification" | "regression">("classification")
  const [labelCol, setLabelCol] = useState(headers[headers.length - 1] ?? "")
  const [featureCols, setFeatureCols] = useState<string[]>(headers.filter((h) => h !== labelCol))
  const [normalize, setNormalize] = useState(true)
  const [testSize, setTestSize] = useState(20)
  const [replace, setReplace] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleFeature(col: string) {
    setFeatureCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])
  }

  function handleLabelChange(col: string) {
    setLabelCol(col)
    setFeatureCols(headers.filter((h) => h !== col))
  }

  async function handleSubmit() {
    if (!taskId.trim()) { setError("Task ID is required"); return }
    if (!labelCol) { setError("Select a label column"); return }
    if (featureCols.length === 0) { setError("Select at least one feature column"); return }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ taskId: taskId.trim(), kind, labelCol, featureCols, normalize, testSize: testSize / 100, replace })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  const rowCount = csv.trim().split(/\r?\n/).length - 1

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
        <ArrowLeft size={12} /> Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Config panel */}
        <div className="space-y-4">
          <div className="card p-4 space-y-4">
            <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider">Task settings</p>

            <div>
              <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">Task ID</label>
              <input value={taskId} onChange={(e) => setTaskId(e.target.value)} className={inputCls} placeholder="my-dataset" />
            </div>

            <div>
              <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">Kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as "classification" | "regression")} className={clsx(inputCls, "cursor-pointer")}>
                <option value="classification">Classification</option>
                <option value="regression">Regression</option>
              </select>
            </div>

            <div>
              <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">Label column</label>
              <select value={labelCol} onChange={(e) => handleLabelChange(e.target.value)} className={clsx(inputCls, "cursor-pointer font-mono")}>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
                  Test split: <span className="font-mono text-[var(--text-1)]">{testSize}%</span>
                </label>
                <input type="range" min="0" max="40" step="5" value={testSize} onChange={(e) => setTestSize(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
              </div>
            </div>

            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-[var(--text-2)] cursor-pointer">
                <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="accent-[var(--accent)]" />
                Normalize features
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text-2)] cursor-pointer">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-[var(--accent)]" />
                Replace existing data
              </label>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-3">Feature columns</p>
            <div className="flex flex-wrap gap-2">
              {headers.filter((h) => h !== labelCol).map((h) => (
                <label key={h} className={clsx(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono cursor-pointer border transition-colors",
                  featureCols.includes(h)
                    ? "bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent-text)]"
                    : "border-[var(--border)] text-[var(--text-3)] hover:border-[var(--accent-border)]"
                )}>
                  <input type="checkbox" checked={featureCols.includes(h)} onChange={() => toggleFeature(h)} className="sr-only" />
                  {h}
                </label>
              ))}
            </div>
            <p className="text-2xs text-[var(--text-3)] mt-2">{featureCols.length} of {headers.length - 1} selected</p>
          </div>
        </div>

        {/* Preview panel */}
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-2)]">
            <span className="font-medium text-[var(--text-1)]">{rowCount.toLocaleString()}</span> rows · preview
          </p>
          <PreviewTable headers={headers} rows={rows} />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className={clsx(
          "w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium transition-colors",
          submitting
            ? "bg-[var(--accent)] text-white opacity-70 cursor-not-allowed"
            : "bg-[var(--accent)] text-white hover:opacity-90"
        )}
      >
        {submitting ? <Loader2 size={14} className="animate-spin" /> : <UploadIcon size={14} />}
        {submitting ? "Uploading…" : "Create task & load data"}
      </button>
    </div>
  )
}

// ── Step 3: Done ───────────────────────────────────────────────────────────────

function StepDone({ result }: { result: ApiUploadResult }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="card p-5 border-[var(--success)] bg-[var(--success-dim)]">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 size={20} className="text-[var(--success)] flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--success)]">Dataset loaded successfully</p>
            <p className="text-xs text-[var(--text-2)] mt-0.5 font-mono">{result.taskId}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total samples", value: result.total.toLocaleString() },
            { label: "Train", value: result.trainCount.toLocaleString() },
            { label: "Test", value: result.testCount.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="card p-3 text-center">
              <p className="stat-num text-lg text-[var(--text-1)]">{value}</p>
              <p className="text-2xs text-[var(--text-3)] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {result.labels && (
        <div className="card p-4">
          <p className="text-xs font-medium text-[var(--text-2)] mb-2">
            {result.labels.length} classes · {result.featureNames.length} features
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.labels.map((l) => (
              <span key={l} className="badge badge-violet font-mono">
                {l}
                {result.labelCounts?.[l] != null && (
                  <span className="text-[var(--text-3)] ml-1">×{result.labelCounts[l]}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="card p-3 border-[var(--warning)]/30">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-[var(--warning)] flex items-center gap-1.5">
              <AlertCircle size={11} />{w}
            </p>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Link
          to={`/tasks/${encodeURIComponent(result.taskId)}`}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium border border-[var(--border)] text-[var(--text-1)] hover:border-[var(--accent-border)] hover:text-[var(--accent-text)] transition-colors"
        >
          View task
        </Link>
        <Link
          to={`/train?task=${encodeURIComponent(result.taskId)}`}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          <PlayCircle size={14} /> Start training
        </Link>
      </div>
    </motion.div>
  )
}

// ── Upload page ────────────────────────────────────────────────────────────────

type Step = "drop" | "configure" | "done"

export function Upload() {
  const [step, setStep] = useState<Step>("drop")
  const [csv, setCsv] = useState("")
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][]; filename: string } | null>(null)
  const [result, setResult] = useState<ApiUploadResult | null>(null)

  const STEPS: Step[] = ["drop", "configure", "done"]
  const stepIdx = STEPS.indexOf(step)

  function handleParsed(csvText: string, filename: string) {
    const { headers, rows } = parsePreview(csvText)
    setCsv(csvText)
    setParsed({ headers, rows, filename })
    setStep("configure")
  }

  async function handleSubmit(cfg: Config) {
    const res = await api.upload(csv, {
      task_id: cfg.taskId,
      kind: cfg.kind,
      label_column: cfg.labelCol,
      feature_columns: cfg.featureCols.join(","),
      normalize: cfg.normalize,
      test_size: cfg.testSize,
      replace: cfg.replace,
    })
    setResult(res)
    setStep("done")
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-1)]">Upload Dataset</h1>
        <p className="text-xs text-[var(--text-3)]">Create a task from a CSV file</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-7">
        {(["drop", "configure", "done"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={clsx(
              "w-6 h-6 rounded-full flex items-center justify-center text-2xs font-semibold transition-colors",
              stepIdx > i ? "bg-[var(--success)] text-white"
                : stepIdx === i ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-3)] text-[var(--text-3)]"
            )}>
              {stepIdx > i ? <CheckCircle2 size={13} /> : i + 1}
            </div>
            <span className={clsx("text-xs capitalize", stepIdx === i ? "text-[var(--text-1)]" : "text-[var(--text-3)]")}>
              {s === "drop" ? "Upload" : s === "configure" ? "Configure" : "Done"}
            </span>
            {i < 2 && <div className={clsx("w-8 h-px", stepIdx > i ? "bg-[var(--success)]" : "bg-[var(--border)]")} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === "drop" && (
          <motion.div key="drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StepDrop onParsed={handleParsed} />
          </motion.div>
        )}
        {step === "configure" && parsed && (
          <motion.div key="configure" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StepConfigure
              csv={csv}
              headers={parsed.headers}
              rows={parsed.rows}
              initialFilename={parsed.filename}
              onBack={() => setStep("drop")}
              onSubmit={handleSubmit}
            />
          </motion.div>
        )}
        {step === "done" && result && (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <StepDone result={result} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
