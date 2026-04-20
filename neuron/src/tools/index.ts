import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { z } from "zod"
import { recordEvent } from "../core/db/events"

import * as createTask from "./create_task"
import * as collect from "./collect"
import * as listSamples from "./list_samples"
import * as deleteSample from "./delete_sample"
import * as preflightCheck from "./preflight_check"
import * as suggestHyperparams from "./suggest_hyperparams"
import * as train from "./train"
import * as cancelTraining from "./cancel_training"
import * as listRuns from "./list_runs"
import * as evaluate from "./evaluate"
import * as predict from "./predict"
import * as diagnose from "./diagnose"
import * as compareRuns from "./compare_runs"
import * as registerModel from "./register_model"
import * as exportModel from "./export_model"
import * as resetTask from "./reset_task"
import * as listTasks from "./list_tasks"
import * as loadCsv from "./load_csv"
import * as loadJson from "./load_json"
import * as loadImages from "./load_images"
import * as getRunStatus from "./get_run_status"
import * as runSweep from "./run_sweep"
import * as publishModel from "./publish_model"
import * as importModel from "./import_model"
import * as listRegistry from "./list_registry"
import * as loadModel from "./load_model"
import * as autoTrain from "./auto_train"
import * as getAutoStatus from "./get_auto_status"
import * as logAutoNote from "./log_auto_note"
import * as suggestSamples from "./suggest_samples"
import * as inspectData from "./inspect_data"
import * as getTrainingCurves from "./get_training_curves"
import * as modelStats from "./model_stats"
import * as batchPredict from "./batch_predict"

type AnySchema = Record<string, z.ZodTypeAny>
type ToolModule = {
  name: string
  description: string
  schema: AnySchema
  handler: (args: Record<string, unknown>, ctx: { server: Server }) => Promise<unknown>
}

const modules: ToolModule[] = [
  createTask, collect, listSamples, deleteSample,
  preflightCheck, suggestHyperparams,
  train, cancelTraining, listRuns, evaluate, predict, diagnose,
  compareRuns, registerModel, exportModel, resetTask, listTasks,
  loadCsv, loadJson, loadImages, getRunStatus,
  runSweep, publishModel, importModel, listRegistry, loadModel,
  autoTrain, getAutoStatus, logAutoNote, suggestSamples,
  inspectData, getTrainingCurves, modelStats, batchPredict,
] as ToolModule[]

export function listTools() {
  return modules.map((m) => ({
    name: m.name,
    description: m.description,
    inputSchema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(m.schema).map(([k, v]) => [k, zodToJsonSchemaProperty(v)])
      ),
      required: Object.entries(m.schema)
        .filter(([, v]) => !v.isOptional())
        .map(([k]) => k),
    },
  }))
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { server: Server }
): Promise<unknown> {
  const mod = modules.find((m) => m.name === name)
  if (!mod) throw new Error(`Unknown tool: ${name}`)

  const taskId = typeof args.task_id === "string" ? args.task_id : undefined
  const runId = typeof args.run_id === "number" ? args.run_id : undefined
  recordEvent({ source: "mcp", kind: "tool_call", taskId, runId, payload: { tool: name } })

  const schema = z.object(mod.schema)
  const parsed = schema.parse(args)
  return mod.handler(parsed as Record<string, unknown>, ctx)
}

// Minimal Zod → JSON Schema for primitive types (enough for MCP tool listing)
function zodToJsonSchemaProperty(schema: z.ZodTypeAny): Record<string, unknown> {
  if (!schema || typeof schema._def !== "object") return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = schema._def as Record<string, any>
  const base: Record<string, unknown> = {}
  if (def.description) base.description = def.description

  const typeName = def.typeName as string
  if (typeName === "ZodString") return { type: "string", ...base }
  if (typeName === "ZodNumber" || typeName === "ZodBigInt") return { type: "number", ...base }
  if (typeName === "ZodBoolean") return { type: "boolean", ...base }
  // ZodArray uses _def.type (not _def.items) for element schema
  if (typeName === "ZodArray") return { type: "array", items: def.type ? zodToJsonSchemaProperty(def.type as z.ZodTypeAny) : {}, ...base }
  // ZodEnum _def.values is an array like ["a","b"]
  if (typeName === "ZodEnum") return { type: "string", enum: Array.isArray(def.values) ? def.values : Object.values(def.values ?? {}), ...base }
  // Unwrappers — ZodOptional, ZodDefault, ZodNullable, ZodReadonly, ZodBranded
  if (["ZodOptional", "ZodDefault", "ZodNullable", "ZodReadonly", "ZodBranded"].includes(typeName)) {
    const inner = def.innerType as z.ZodTypeAny | undefined
    if (!inner) return { ...base }
    const inner2 = inner
    const result = zodToJsonSchemaProperty(inner2)
    return { ...result, ...base }
  }
  if (typeName === "ZodUnion") return { oneOf: (def.options as z.ZodTypeAny[] ?? []).map(zodToJsonSchemaProperty), ...base }
  if (typeName === "ZodLiteral") return { const: def.value, ...base }
  if (typeName === "ZodUnknown" || typeName === "ZodAny") return { ...base }
  return { ...base }
}
