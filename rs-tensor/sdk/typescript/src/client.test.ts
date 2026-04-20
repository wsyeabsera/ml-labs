import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RsTensorClient,
  RsTensorMcpError,
  defaultMcpStdioParams,
  defaultRsTensorRoot,
  extractTextContent,
  trainXorMlp,
  type RsTensorToolCaller,
} from "./client.js";

function okJson(body: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    isError: false as const,
  };
}

describe("RsTensorMcpError", () => {
  it("formats message", () => {
    const e = new RsTensorMcpError("tensor_create", "bad");
    expect(e.name).toBe("RsTensorMcpError");
    expect(e.toolName).toBe("tensor_create");
    expect(e.message).toBe('rs-tensor MCP tool "tensor_create": bad');
  });
});

describe("defaultRsTensorRoot", () => {
  it("resolves to rs-tensor crate (three parents from src/)", () => {
    const root = defaultRsTensorRoot();
    expect(root.endsWith("rs-tensor")).toBe(true);
  });
});

describe("defaultMcpStdioParams", () => {
  it("uses defaultRsTensorRoot when cwd omitted", () => {
    const p = defaultMcpStdioParams();
    expect(p.command).toBe("cargo");
    expect(p.args).toEqual(["run", "--quiet", "--bin", "mcp"]);
    expect(p.cwd).toBe(defaultRsTensorRoot());
    expect(p.stderr).toBe("inherit");
  });

  it("uses explicit root", () => {
    const p = defaultMcpStdioParams("/custom/rs-tensor");
    expect(p.cwd).toBe("/custom/rs-tensor");
  });
});

describe("extractTextContent", () => {
  it("returns empty for empty content", () => {
    expect(extractTextContent([])).toBe("");
  });

  it("joins trimmed text blocks", () => {
    expect(
      extractTextContent([
        { type: "text", text: "  a  " },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("skips non-text and text without string", () => {
    expect(
      extractTextContent([
        { type: "image", text: "x" },
        { type: "text" },
        { type: "text", text: "ok" },
      ]),
    ).toBe("ok");
  });
});

describe("RsTensorClient (toolCaller)", () => {
  let callTool: ReturnType<typeof vi.fn>;
  let toolCaller: RsTensorToolCaller;

  beforeEach(() => {
    callTool = vi.fn();
    toolCaller = { callTool };
  });

  function client() {
    return new RsTensorClient({ toolCaller });
  }

  it("connect twice throws", async () => {
    const c = client();
    await c.connect();
    await expect(c.connect()).rejects.toThrow("already connected");
  });

  it("close clears dry connect state so connect works again", async () => {
    const c = client();
    await c.connect();
    await c.close();
    await c.connect();
    await c.close();
  });

  it("callToolJson success", async () => {
    callTool.mockResolvedValue(okJson({ op: "tensor_create", name: "t" }));
    const c = client();
    const r = await c.tensorCreate({
      name: "t",
      data: [1],
      shape: [1],
    });
    expect(r.name).toBe("t");
    expect(callTool).toHaveBeenCalledWith({
      name: "tensor_create",
      arguments: { name: "t", data: [1], shape: [1] },
    });
  });

  it("isError with message", async () => {
    callTool.mockResolvedValue({
      content: [{ type: "text", text: "oops" }],
      isError: true,
    });
    await expect(client().tensorList()).rejects.toMatchObject({
      name: "RsTensorMcpError",
      toolName: "tensor_list",
    });
  });

  it("isError without text uses default message", async () => {
    callTool.mockResolvedValue({
      content: [],
      isError: true,
    });
    await expect(client().tensorList()).rejects.toThrow("(no message)");
  });

  it("empty success body", async () => {
    callTool.mockResolvedValue({
      content: [{ type: "text", text: "   " }],
      isError: false,
    });
    await expect(client().tensorList()).rejects.toThrow("empty tool response");
  });

  it("invalid JSON", async () => {
    callTool.mockResolvedValue({
      content: [{ type: "text", text: "not-json {{{" }],
      isError: false,
    });
    await expect(client().tensorList()).rejects.toThrow("expected JSON body");
  });

  it("invalid JSON embeds truncated body", async () => {
    const long = "x".repeat(250);
    callTool.mockResolvedValue({
      content: [{ type: "text", text: long }],
      isError: false,
    });
    const err = await client().tensorList().catch((e) => e);
    expect(err).toBeInstanceOf(RsTensorMcpError);
    expect((err as RsTensorMcpError).message).toContain("x".repeat(200));
    expect((err as RsTensorMcpError).message).not.toContain("x".repeat(201));
  });

  const toolCases: Array<{
    method: keyof RsTensorClient;
    tool: string;
    args: Record<string, unknown>;
  }> = [
    {
      method: "tensorAdd",
      tool: "tensor_add",
      args: { a: "x", b: "y", result_name: "z" },
    },
    {
      method: "tensorMul",
      tool: "tensor_mul",
      args: { a: "x", b: "y", result_name: "z" },
    },
    {
      method: "tensorMatmul",
      tool: "tensor_matmul",
      args: { a: "x", b: "y", result_name: "z" },
    },
    {
      method: "tensorGet2d",
      tool: "tensor_get_2d",
      args: { name: "t", row: 0, col: 0 },
    },
    {
      method: "tensorGet",
      tool: "tensor_get",
      args: { name: "t", indices: [0, 1] },
    },
    {
      method: "tensorReshape",
      tool: "tensor_reshape",
      args: { name: "t", new_shape: [2, 2], result_name: "r" },
    },
    {
      method: "tensorTranspose",
      tool: "tensor_transpose",
      args: { name: "t", result_name: "r" },
    },
    {
      method: "tensorTranspose",
      tool: "tensor_transpose",
      args: { name: "t", result_name: "r", dim0: 1, dim1: 0 },
    },
    {
      method: "tensorInspect",
      tool: "tensor_inspect",
      args: { name: "t" },
    },
    { method: "tensorList", tool: "tensor_list", args: {} },
    { method: "readFile", tool: "read_file", args: { path: "Cargo.toml" } },
    { method: "cargoExec", tool: "cargo_exec", args: { command: "build" } },
    {
      method: "createDataset",
      tool: "create_dataset",
      args: { type: "xor" },
    },
    {
      method: "initMlp",
      tool: "init_mlp",
      args: { architecture: [2, 1] },
    },
    {
      method: "mseLoss",
      tool: "mse_loss",
      args: { predicted: "p", target: "t" },
    },
    {
      method: "trainMlp",
      tool: "train_mlp",
      args: {
        mlp: "m",
        inputs: "i",
        targets: "t",
        lr: 0.1,
        epochs: 1,
      },
    },
    {
      method: "evaluateMlp",
      tool: "evaluate_mlp",
      args: { mlp: "m", inputs: "i" },
    },
    {
      method: "mlpPredict",
      tool: "mlp_predict",
      args: { mlp: "m", input: [1, 2] },
    },
    {
      method: "autogradNeuron",
      tool: "autograd_neuron",
      args: { inputs: [1], weights: [2], bias: 0 },
    },
    {
      method: "autogradExpr",
      tool: "autograd_expr",
      args: {
        values: [["a", 1]],
        ops: [["b", "tanh", "a"]],
        backward_from: "b",
      },
    },
    {
      method: "autogradNeuronTensor",
      tool: "autograd_neuron_tensor",
      args: {
        input_data: [1],
        input_shape: [1, 1],
        weight_data: [1],
        weight_shape: [1, 1],
        bias_data: [0],
        bias_shape: [1, 1],
      },
    },
    {
      method: "mlpForward",
      tool: "mlp_forward",
      args: {
        input_data: [1, 2],
        input_shape: [1, 2],
        layers: [
          {
            weights: [1, 1],
            bias: [0],
            in_features: 2,
            out_features: 1,
          },
        ],
      },
    },
    {
      method: "attentionForward",
      tool: "attention_forward",
      args: {
        q_data: [1],
        k_data: [1],
        v_data: [1],
        seq_len: 1,
        d_k: 1,
      },
    },
    {
      method: "attentionForward",
      tool: "attention_forward",
      args: {
        q_data: [1],
        k_data: [1],
        v_data: [1],
        seq_len: 1,
        d_k: 1,
        d_v: 2,
      },
    },
    { method: "ggufInspect", tool: "gguf_inspect", args: { path: "x.gguf" } },
    {
      method: "ggufLoadTensor",
      tool: "gguf_load_tensor",
      args: { path: "x.gguf", tensor_name: "w" },
    },
    { method: "llamaLoad", tool: "llama_load", args: { path: "m.gguf" } },
    {
      method: "llamaGenerate",
      tool: "llama_generate",
      args: { prompt: "hi" },
    },
    { method: "llamaInspect", tool: "llama_inspect", args: {} },
  ];

  for (let i = 0; i < toolCases.length; i++) {
    const tc = toolCases[i]!;
    it(`tool dispatch ${i}: ${String(tc.method)} -> ${tc.tool}`, async () => {
      callTool.mockResolvedValue(okJson({ op: tc.tool }));
      const c = client();
      const run = c[tc.method] as (...args: unknown[]) => Promise<unknown>;
      if (tc.method === "tensorList" || tc.method === "llamaInspect") {
        await run.call(c);
      } else {
        await run.call(c, tc.args);
      }
      const last = callTool.mock.calls.at(-1)?.[0];
      expect(last?.name).toBe(tc.tool);
      expect(last?.arguments).toEqual(
        tc.method === "llamaInspect" ? {} : tc.args,
      );
    });
  }
});

describe("trainXorMlp", () => {
  it("runs pipeline with defaults", async () => {
    const callTool = vi.fn();
    const seq = [
      okJson({
        op: "create_dataset",
        type: "xor",
        input_name: "xor_inputs",
        target_name: "xor_targets",
      }),
      okJson({
        op: "init_mlp",
        name: "mlp",
        architecture: [2, 4, 1],
      }),
      okJson({
        op: "train_mlp",
        final_loss: 0.01,
      }),
    ];
    callTool.mockImplementation(() => Promise.resolve(seq.shift() ?? okJson({})));
    const c = new RsTensorClient({ toolCaller: { callTool } });
    const out = await trainXorMlp(c);
    expect(out.dataset.input_name).toBe("xor_inputs");
    expect(out.init.architecture).toEqual([2, 4, 1]);
    expect(out.training.final_loss).toBe(0.01);
    expect(callTool).toHaveBeenCalledTimes(3);
    const trainArgs = callTool.mock.calls[2]![0].arguments as Record<
      string,
      unknown
    >;
    expect(trainArgs.lr).toBe(0.15);
    expect(trainArgs.epochs).toBe(800);
  });

  it("respects custom options", async () => {
    const callTool = vi.fn();
    callTool
      .mockResolvedValueOnce(
        okJson({
          op: "create_dataset",
          input_name: "xor_inputs",
          target_name: "xor_targets",
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          op: "init_mlp",
          name: "net",
          architecture: [2, 8, 1],
        }),
      )
      .mockResolvedValueOnce(okJson({ op: "train_mlp" }));
    const c = new RsTensorClient({ toolCaller: { callTool } });
    await trainXorMlp(c, {
      mlpName: "net",
      hidden: 8,
      lr: 0.05,
      epochs: 10,
    });
    const initArgs = callTool.mock.calls[1]![0].arguments as {
      architecture: number[];
    };
    expect(initArgs.architecture).toEqual([2, 8, 1]);
    const trainArgs = callTool.mock.calls[2]![0].arguments as {
      lr: number;
      epochs: number;
    };
    expect(trainArgs.lr).toBe(0.05);
    expect(trainArgs.epochs).toBe(10);
  });
});
