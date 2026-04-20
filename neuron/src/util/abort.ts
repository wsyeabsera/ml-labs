export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Operation cancelled")
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Operation cancelled")) }, { once: true })
  })
}
