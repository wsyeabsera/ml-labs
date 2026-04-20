import { useEffect, useState } from "react"
import { codeToHtml } from "shiki"
import { Copy, Check } from "lucide-react"

interface CodeBlockProps {
  code: string
  lang?: string
  title?: string
  className?: string
}

export function CodeBlock({ code, lang = "typescript", title, className }: CodeBlockProps) {
  const [html, setHtml] = useState<string>("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    codeToHtml(code.trim(), { lang, theme: "github-dark-default" }).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  const copy = async () => {
    await navigator.clipboard.writeText(code.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className={`group relative my-5 ${className ?? ""}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2 rounded-t-xl bg-lab-panel border border-b-0 border-lab-border">
          <span className="text-xs font-mono text-lab-muted">{title}</span>
          <span className="text-[10px] uppercase tracking-wider text-lab-muted/70">{lang}</span>
        </div>
      )}
      <div className="relative">
        {html ? (
          <div
            className={title ? "[&_pre]:!rounded-t-none" : ""}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="shiki">
            <code>{code.trim()}</code>
          </pre>
        )}
        <button
          onClick={copy}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-lab-panel border border-lab-border hover:border-cyan-neon/50 hover:text-cyan-neon text-lab-muted"
          aria-label="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}
