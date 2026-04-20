import { z } from "zod"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { insertSample, sampleCounts } from "../core/db/samples"
import { loadImages } from "../core/loaders/images"
import { loadConfig } from "../adapter/loader"
import { log } from "../core/logger"
import { existsSync } from "node:fs"

export const name = "load_images"
export const description = "Batch-ingest images from a directory. Expected structure: dir/{label}/*.{jpg,png}. Requires featurize in neuron.config.ts or uses sharp default decode."

export const schema = {
  task_id: z.string().describe("Task ID to load samples into"),
  dir: z.string().describe("Directory containing label subdirectories, each with image files"),
  extensions: z.array(z.string()).optional().describe("File extensions to include (default: .jpg .jpeg .png .webp)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)
  if (!existsSync(args.dir)) throw new Error(`Directory not found: ${args.dir}`)

  const config = await loadConfig()

  log(`Loading images from ${args.dir} → task "${args.task_id}"`)

  const { samples, errors } = await loadImages({
    dir: args.dir,
    extensions: args.extensions,
    sampleShape: task.sampleShape ?? task.featureShape,
    decodeImage: config?.decodeImage
      ? (buf, meta) => config.decodeImage!(buf, meta) as Promise<number[]>
      : undefined,
  })

  let inserted = 0
  const knownLabels = new Set(task.labels ?? [])

  for (const sample of samples) {
    let features: number[]

    if (config?.featurize) {
      try {
        features = await config.featurize(sample.raw)
      } catch (e) {
        errors.push(`${sample.path}: featurize failed — ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
    } else {
      // raw IS the feature vector (generic decode path)
      features = sample.raw
    }

    insertSample(args.task_id, sample.label, features, sample.raw)
    inserted++
    if (!knownLabels.has(sample.label)) {
      knownLabels.add(sample.label)
      updateTaskLabels(args.task_id, [...knownLabels].sort())
    }
  }

  const counts = sampleCounts(args.task_id)
  log(`Image load complete: ${inserted} inserted, ${errors.length} errors`)

  return {
    ok: true,
    inserted,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    per_label: counts,
  }
}
