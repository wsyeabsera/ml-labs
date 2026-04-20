import { describe, it, expect } from "vitest";
import * as sdk from "./index.js";

describe("index barrel", () => {
  it("exports package constant", () => {
    expect(sdk.RS_TENSOR_MCP_PACKAGE).toBe("rs-tensor-mcp");
  });

  it("exports client API", () => {
    expect(sdk.RsTensorClient).toBeDefined();
    expect(sdk.RsTensorMcpError).toBeDefined();
    expect(sdk.defaultMcpStdioParams).toBeDefined();
    expect(sdk.defaultRsTensorRoot).toBeDefined();
    expect(sdk.extractTextContent).toBeDefined();
    expect(sdk.trainXorMlp).toBeDefined();
  });
});
