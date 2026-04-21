import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, Upload, Play, Loader2, AlertCircle, X, Cpu } from "lucide-react"
import { api } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { clsx } from "clsx"

const inputCls = "w-full text-sm px-3 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-[var(--accent-border)] transition-colors"

function num(v: number | undefined | null) {
  return v != null ? v.toLocaleString() : "—"
}

function LoadCard() {
  const qc = useQueryClient()
  const [path, setPath] = useState("")
  const [error, setError] = useState<string | null>(null)

  const { data: status, isLoading } = useQuery({
    queryKey: ["llm-status"],
    queryFn: api.llmStatus,
    refetchInterval: 5000,
  })

  const load = useMutation({
    mutationFn: (p: string) => api.llmLoad(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-status"] }),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const cfg = status?.inspect?.config
  const loaded = !!status?.loaded

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Cpu size={14} className="text-[var(--accent-text)]" />
        <p className="text-xs font-medium text-[var(--text-1)]">Model</p>
        {loaded ? (
          <span className="ml-auto text-2xs font-mono text-[var(--success)]">● loaded</span>
        ) : (
          <span className="ml-auto text-2xs font-mono text-[var(--text-3)]">not loaded</span>
        )}
      </div>

      {!loaded && (
        <div className="space-y-3">
          <div>
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
              GGUF path
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/absolute/path/to/model.gguf"
                className={clsx(inputCls, "font-mono")}
                spellCheck={false}
              />
              <button
                onClick={() => { setError(null); load.mutate(path) }}
                disabled={!path || load.isPending}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
                  load.isPending
                    ? "bg-[var(--accent)] text-white opacity-60 cursor-not-allowed"
                    : "bg-[var(--accent)] text-white hover:opacity-90",
                )}
              >
                {load.isPending ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                Load
              </button>
            </div>
          </div>
          <p className="text-2xs text-[var(--text-3)]">
            CPU-only inference. Small Q4/Q8 models (≤1B params) recommended — larger will load but generate at &lt;5 tok/s.
          </p>
        </div>
      )}

      {loaded && cfg && (
        <div>
          {status?.info && (
            <pre className="text-2xs text-[var(--text-3)] font-mono mb-3 whitespace-pre-wrap leading-relaxed">
              {status.info}
            </pre>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: "dim",       value: num(cfg.dim) },
              { label: "layers",    value: num(cfg.n_layers) },
              { label: "heads",     value: `${cfg.n_heads}${cfg.n_kv_heads !== cfg.n_heads ? `/${cfg.n_kv_heads}kv` : ""}` },
              { label: "vocab",     value: num(cfg.vocab_size) },
              { label: "ffn_dim",   value: num(cfg.ffn_dim) },
              { label: "head_dim",  value: num(cfg.head_dim) },
              { label: "params",    value: status?.inspect?.total_parameters_human ?? "—" },
              { label: "rms_eps",   value: cfg.rms_eps.toExponential(1) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md bg-[var(--surface-2)] p-2">
                <p className="text-2xs text-[var(--text-3)]">{label}</p>
                <p className="stat-num text-xs text-[var(--text-1)]">{value}</p>
              </div>
            ))}
          </div>
          {status?.inspect?.vocab_sample_first_20 && (
            <details className="mt-3">
              <summary className="text-2xs text-[var(--text-3)] cursor-pointer hover:text-[var(--text-2)]">vocab sample</summary>
              <p className="text-2xs text-[var(--text-2)] font-mono mt-1 leading-relaxed break-all">
                {status.inspect.vocab_sample_first_20.slice(0, 40).join(" · ")}
              </p>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2 mt-3">
          <AlertCircle size={12} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X size={11} />
          </button>
        </div>
      )}

      {isLoading && <p className="text-2xs text-[var(--text-3)]">Loading status…</p>}
    </div>
  )
}

function GenerateCard() {
  const [prompt, setPrompt] = useState("")
  const [maxTokens, setMaxTokens] = useState(64)
  const [temperature, setTemperature] = useState(0.8)
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.llmGenerate>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: status } = useQuery({ queryKey: ["llm-status"], queryFn: api.llmStatus })
  const loaded = !!status?.loaded

  const gen = useMutation({
    mutationFn: (args: { prompt: string; max_tokens: number; temperature: number }) => api.llmGenerate(args),
    onSuccess: (r) => setResult(r),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} className="text-[var(--accent-text)]" />
        <p className="text-xs font-medium text-[var(--text-1)]">Generate</p>
      </div>

      {!loaded && (
        <p className="text-xs text-[var(--text-3)]">Load a model first.</p>
      )}

      {loaded && (
        <div className="space-y-3">
          <div>
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Hello, my name is"
              className={clsx(inputCls, "resize-y min-h-[80px]")}
              spellCheck={false}
            />
            <p className="text-2xs text-[var(--text-3)] mt-1">
              Naive whitespace tokenization — unknown words are silently skipped. For real text, pre-tokenize via the MCP tool with <span className="font-mono">token_ids</span>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
                Max tokens <span className="font-mono text-[var(--text-2)] ml-1">{maxTokens}</span>
              </label>
              <input
                type="range"
                min={8}
                max={512}
                step={8}
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
                Temperature <span className="font-mono text-[var(--text-2)] ml-1">{temperature.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={() => { setError(null); setResult(null); gen.mutate({ prompt, max_tokens: maxTokens, temperature }) }}
            disabled={!prompt || gen.isPending}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              gen.isPending
                ? "bg-[var(--accent)] text-white opacity-60 cursor-not-allowed"
                : "bg-[var(--accent)] text-white hover:opacity-90",
            )}
          >
            {gen.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {gen.isPending ? "Generating…" : "Generate"}
          </button>

          {error && (
            <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2">
              <AlertCircle size={12} />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
                <X size={11} />
              </button>
            </div>
          )}

          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                <div className="rounded-md bg-[var(--surface-2)] border border-[var(--border-subtle)] p-3">
                  <p className="text-2xs text-[var(--text-3)] mb-1.5">Generated</p>
                  <pre className="text-xs text-[var(--text-1)] whitespace-pre-wrap leading-relaxed font-mono">
                    {result.text || "(empty — no tokens matched vocab)"}
                  </pre>
                </div>
                <div className="flex items-center gap-3 text-2xs font-mono text-[var(--text-3)]">
                  <span>{result.num_generated} tokens</span>
                  <span>{result.elapsed_ms}ms</span>
                  <span>{result.tokens_per_sec} tok/s</span>
                  <span className="ml-auto">prompt: {result.prompt_tokens.length} tok</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

export function Playground() {
  return (
    <div>
      <PageHeader
        title="Playground"
        subtitle="Load a small GGUF model and test inference."
      />
      <div className="space-y-4">
        <LoadCard />
        <GenerateCard />
      </div>
    </div>
  )
}
