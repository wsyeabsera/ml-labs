import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  AttentionForwardArgs,
  AutogradExprArgs,
  AutogradNeuronArgs,
  AutogradNeuronTensorArgs,
  AvgPool2dArgs,
  BatchNorm2dArgs,
  CargoExecArgs,
  CnnForwardArgs,
  CnnForwardResult,
  Conv2dArgs,
  CreateDatasetArgs,
  CreateDatasetResult,
  EvaluateMlpArgs,
  FlattenArgs,
  GgufInspectArgs,
  GgufLoadTensorArgs,
  GlobalAvgPoolArgs,
  InitCnnArgs,
  InitCnnResult,
  InitMlpArgs,
  InitMlpResult,
  JsonObject,
  LayerDef,
  LlamaGenerateArgs,
  LlamaLoadArgs,
  MaxPool2dArgs,
  MlpForwardArgs,
  MlpPredictArgs,
  MseLossArgs,
  ReadFileArgs,
  TensorBinaryOpArgs,
  TensorCreateArgs,
  TensorGet2dArgs,
  TensorGetArgs,
  TensorInspectArgs,
  TensorMatmulArgs,
  TensorOpResult,
  TensorReshapeArgs,
  TensorTransposeArgs,
  TrainMlpArgs,
  TrainMlpResult,
} from "./types.js";

export class RsTensorMcpError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
  ) {
    super(`rs-tensor MCP tool "${toolName}": ${message}`);
    this.name = "RsTensorMcpError";
  }
}

/** Directory containing the `rs-tensor` crate (parent of `sdk/`). */
export function defaultRsTensorRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ -> sdk/typescript/ -> sdk/ -> rs-tensor/
  return join(here, "..", "..", "..");
}

/** Spawn the MCP server via `cargo run --bin mcp` from the crate root. */
export function defaultMcpStdioParams(rsTensorRoot?: string): StdioServerParameters {
  const cwd = rsTensorRoot ?? defaultRsTensorRoot();
  return {
    command: "cargo",
    args: ["run", "--quiet", "--bin", "mcp"],
    cwd,
    stderr: "inherit",
  };
}

/** Minimal MCP surface used by {@link RsTensorClient} (inject for unit tests). */
export type RsTensorToolCaller = {
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
};

export interface RsTensorClientOptions {
  /** If omitted, uses {@link defaultMcpStdioParams}. */
  transport?: StdioServerParameters;
  /**
   * When set, {@link RsTensorClient.connect} / {@link RsTensorClient.close} are dry-run
   * and all tool calls go through this (no real MCP stdio process).
   */
  toolCaller?: RsTensorToolCaller;
}

export function extractTextContent(
  content: Array<{ type: string; text?: string }>,
): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text.trim());
    }
  }
  return parts.join("\n").trim();
}

export class RsTensorClient {
  private readonly mcp: Client;
  private transport: StdioClientTransport | null = null;
  private readonly toolCaller: RsTensorToolCaller | null;
  private dryConnected = false;

  constructor(options: RsTensorClientOptions = {}) {
    this.mcp = new Client({ name: "rs-tensor-mcp", version: "0.1.0" });
    this._stdioParams = options.transport ?? defaultMcpStdioParams();
    this.toolCaller = options.toolCaller ?? null;
  }

  private readonly _stdioParams: StdioServerParameters;

  async connect(): Promise<void> {
    if (this.toolCaller) {
      if (this.dryConnected) {
        throw new Error("RsTensorClient already connected");
      }
      this.dryConnected = true;
      return;
    }
    if (this.transport) {
      throw new Error("RsTensorClient already connected");
    }
    this.transport = new StdioClientTransport(this._stdioParams);
    await this.mcp.connect(this.transport);
  }

  async close(): Promise<void> {
    if (this.toolCaller) {
      this.dryConnected = false;
      return;
    }
    await this.mcp.close();
    this.transport = null;
  }

  private async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }> {
    if (this.toolCaller) {
      return this.toolCaller.callTool({ name, arguments: args });
    }
    return this.mcp.callTool({ name, arguments: args }) as Promise<{
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }>;
  }

  private async callToolJson<T = JsonObject>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.invokeTool(name, args);
    const text = extractTextContent(result.content);
    if (result.isError) {
      throw new RsTensorMcpError(name, text || "(no message)");
    }
    if (!text) {
      throw new RsTensorMcpError(name, "empty tool response");
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RsTensorMcpError(
        name,
        `expected JSON body, got: ${text.slice(0, 200)}`,
      );
    }
  }

  // --- Tensor ops ---

  tensorCreate(args: TensorCreateArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_create", args as unknown as Record<string, unknown>);
  }

  tensorAdd(args: TensorBinaryOpArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_add", args as unknown as Record<string, unknown>);
  }

  tensorMul(args: TensorBinaryOpArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_mul", args as unknown as Record<string, unknown>);
  }

  tensorMatmul(args: TensorMatmulArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_matmul", args as unknown as Record<string, unknown>);
  }

  tensorGet2d(args: TensorGet2dArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_get_2d", args as unknown as Record<string, unknown>);
  }

  tensorGet(args: TensorGetArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_get", args as unknown as Record<string, unknown>);
  }

  tensorReshape(args: TensorReshapeArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_reshape", args as unknown as Record<string, unknown>);
  }

  tensorTranspose(args: TensorTransposeArgs): Promise<TensorOpResult> {
    const a: Record<string, unknown> = {
      name: args.name,
      result_name: args.result_name,
    };
    if (args.dim0 !== undefined) a.dim0 = args.dim0;
    if (args.dim1 !== undefined) a.dim1 = args.dim1;
    return this.callToolJson("tensor_transpose", a);
  }

  tensorInspect(args: TensorInspectArgs): Promise<TensorOpResult> {
    return this.callToolJson("tensor_inspect", args as unknown as Record<string, unknown>);
  }

  tensorList(): Promise<TensorOpResult> {
    return this.callToolJson("tensor_list", {});
  }

  // --- Project ---

  readFile(args: ReadFileArgs): Promise<JsonObject> {
    return this.callToolJson("read_file", args as unknown as Record<string, unknown>);
  }

  cargoExec(args: CargoExecArgs): Promise<JsonObject> {
    return this.callToolJson("cargo_exec", args as unknown as Record<string, unknown>);
  }

  // --- Training ---

  createDataset(args: CreateDatasetArgs): Promise<CreateDatasetResult> {
    return this.callToolJson("create_dataset", args as unknown as Record<string, unknown>);
  }

  initMlp(args: InitMlpArgs): Promise<InitMlpResult> {
    return this.callToolJson("init_mlp", args as unknown as Record<string, unknown>);
  }

  mseLoss(args: MseLossArgs): Promise<JsonObject> {
    return this.callToolJson("mse_loss", args as unknown as Record<string, unknown>);
  }

  trainMlp(args: TrainMlpArgs): Promise<TrainMlpResult> {
    return this.callToolJson("train_mlp", args as unknown as Record<string, unknown>);
  }

  evaluateMlp(args: EvaluateMlpArgs): Promise<JsonObject> {
    return this.callToolJson("evaluate_mlp", args as unknown as Record<string, unknown>);
  }

  mlpPredict(args: MlpPredictArgs): Promise<JsonObject> {
    return this.callToolJson("mlp_predict", args as unknown as Record<string, unknown>);
  }

  // --- Autograd ---

  autogradNeuron(args: AutogradNeuronArgs): Promise<JsonObject> {
    return this.callToolJson("autograd_neuron", args as unknown as Record<string, unknown>);
  }

  autogradExpr(args: AutogradExprArgs): Promise<JsonObject> {
    return this.callToolJson("autograd_expr", {
      values: args.values,
      ops: args.ops,
      backward_from: args.backward_from,
    });
  }

  autogradNeuronTensor(args: AutogradNeuronTensorArgs): Promise<JsonObject> {
    return this.callToolJson(
      "autograd_neuron_tensor",
      args as unknown as Record<string, unknown>,
    );
  }

  mlpForward(args: MlpForwardArgs): Promise<JsonObject> {
    return this.callToolJson("mlp_forward", {
      input_data: args.input_data,
      input_shape: args.input_shape,
      layers: args.layers.map((L: LayerDef) => ({
        weights: L.weights,
        bias: L.bias,
        in_features: L.in_features,
        out_features: L.out_features,
      })),
    });
  }

  attentionForward(args: AttentionForwardArgs): Promise<JsonObject> {
    const a: Record<string, unknown> = {
      q_data: args.q_data,
      k_data: args.k_data,
      v_data: args.v_data,
      seq_len: args.seq_len,
      d_k: args.d_k,
    };
    if (args.d_v !== undefined) a.d_v = args.d_v;
    return this.callToolJson("attention_forward", a);
  }

  // --- GGUF / LLaMA ---

  ggufInspect(args: GgufInspectArgs): Promise<JsonObject> {
    return this.callToolJson("gguf_inspect", args as unknown as Record<string, unknown>);
  }

  ggufLoadTensor(args: GgufLoadTensorArgs): Promise<JsonObject> {
    return this.callToolJson("gguf_load_tensor", args as unknown as Record<string, unknown>);
  }

  llamaLoad(args: LlamaLoadArgs): Promise<JsonObject> {
    return this.callToolJson("llama_load", args as unknown as Record<string, unknown>);
  }

  llamaGenerate(args: LlamaGenerateArgs): Promise<JsonObject> {
    return this.callToolJson("llama_generate", args as unknown as Record<string, unknown>);
  }

  llamaInspect(): Promise<JsonObject> {
    return this.callToolJson("llama_inspect", {});
  }

  // --- CNN ---

  conv2dForward(args: Conv2dArgs): Promise<TensorOpResult> {
    return this.callToolJson("conv2d_forward", args as unknown as Record<string, unknown>);
  }

  maxPool2d(args: MaxPool2dArgs): Promise<TensorOpResult> {
    return this.callToolJson("max_pool2d", args as unknown as Record<string, unknown>);
  }

  avgPool2d(args: AvgPool2dArgs): Promise<TensorOpResult> {
    return this.callToolJson("avg_pool2d", args as unknown as Record<string, unknown>);
  }

  batchNorm2d(args: BatchNorm2dArgs): Promise<TensorOpResult> {
    return this.callToolJson("batch_norm2d", args as unknown as Record<string, unknown>);
  }

  flattenTensor(args: FlattenArgs): Promise<TensorOpResult> {
    return this.callToolJson("flatten_tensor", args as unknown as Record<string, unknown>);
  }

  globalAvgPool(args: GlobalAvgPoolArgs): Promise<TensorOpResult> {
    return this.callToolJson("global_avg_pool", args as unknown as Record<string, unknown>);
  }

  initCnn(args: InitCnnArgs): Promise<InitCnnResult> {
    return this.callToolJson("init_cnn", args as unknown as Record<string, unknown>);
  }

  cnnForward(args: CnnForwardArgs): Promise<CnnForwardResult> {
    return this.callToolJson("cnn_forward", args as unknown as Record<string, unknown>);
  }
}

export interface TrainXorOptions {
  mlpName?: string;
  hidden?: number;
  lr?: number;
  epochs?: number;
}

/**
 * Convenience: create XOR dataset, init a small MLP, train with SGD.
 * Uses tensor names from `create_dataset` (`xor_inputs`, `xor_targets`).
 */
export async function trainXorMlp(
  client: RsTensorClient,
  opts: TrainXorOptions = {},
): Promise<{
  dataset: CreateDatasetResult;
  init: InitMlpResult;
  training: TrainMlpResult;
}> {
  const dataset = await client.createDataset({ type: "xor" });
  const name = opts.mlpName ?? "mlp";
  const hidden = opts.hidden ?? 4;
  const init = await client.initMlp({
    architecture: [2, hidden, 1],
    name,
  });
  const training = await client.trainMlp({
    mlp: init.name,
    inputs: dataset.input_name,
    targets: dataset.target_name,
    lr: opts.lr ?? 0.15,
    epochs: opts.epochs ?? 800,
  });
  return { dataset, init, training };
}
