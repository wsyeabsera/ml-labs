const PORT = 2626

export async function reset(taskId: string | undefined, args: string[]) {
  if (!taskId) {
    console.error("Usage: ml-labs reset <task_id> [--delete]")
    process.exit(1)
  }

  const mode = args.includes("--delete") ? "delete" : "reset"
  const url = `http://localhost:${PORT}/api/tasks/${encodeURIComponent(taskId)}?mode=${mode}`

  console.log(`${mode === "delete" ? "Deleting" : "Resetting"} task "${taskId}"…`)

  let res: Response
  try {
    res = await fetch(url, { method: "DELETE" })
  } catch {
    console.error(`Could not reach the dashboard API at localhost:${PORT}. Is it running?\n  ml-labs dashboard`)
    process.exit(1)
  }

  const data = await res.json() as { ok?: boolean; deleted?: boolean; taskId?: string; error?: string }
  if (!res.ok) {
    console.error(`Error: ${data.error ?? `HTTP ${res.status}`}`)
    process.exit(1)
  }

  if (data.deleted) {
    console.log(`Task "${taskId}" deleted.`)
  } else {
    console.log(`Task "${taskId}" reset — samples, runs, and model weights cleared.`)
  }
}
