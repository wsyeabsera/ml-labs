import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCallTool, mockConnect, mockClose } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = mockConnect;
    close = mockClose;
    callTool = mockCallTool;
    constructor() {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function MockTransport() {
    return { _mock: true };
  }),
}));

import { RsTensorClient } from "./client.js";

describe("RsTensorClient (real MCP client path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: '{"op":"tensor_create","name":"x"}' }],
      isError: false,
    });
  });

  it("forwards tool calls to MCP Client.callTool", async () => {
    const c = new RsTensorClient({
      transport: {
        command: "cargo",
        args: ["run", "--bin", "mcp"],
        cwd: "/tmp",
        stderr: "inherit",
      },
    });
    const r = await c.tensorCreate({ name: "x", data: [1], shape: [1] });
    expect(r.name).toBe("x");
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "tensor_create",
      arguments: { name: "x", data: [1], shape: [1] },
    });
  });

  it("connect uses StdioClientTransport and Client.connect", async () => {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const c = new RsTensorClient({
      transport: { command: "x", cwd: "/y", stderr: "inherit" },
    });
    await c.connect();
    expect(StdioClientTransport).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    await expect(c.connect()).rejects.toThrow("already connected");
    await c.close();
    expect(mockClose).toHaveBeenCalled();
    await c.connect();
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });
});
