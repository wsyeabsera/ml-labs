/**
 * Integration smoke: tensor_create + tensor_list against a live MCP server.
 */
import { RsTensorClient, defaultMcpStdioParams } from "../src/client.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sdkDir = dirname(fileURLToPath(import.meta.url));
const rsTensorRoot =
  process.env.RS_TENSOR_ROOT ?? join(sdkDir, "..", "..", "..");

async function main(): Promise<void> {
  const client = new RsTensorClient({
    transport: {
      ...defaultMcpStdioParams(rsTensorRoot),
      cwd: rsTensorRoot,
    },
  });

  await client.connect();
  try {
    await client.tensorCreate({
      name: "sdk_smoke",
      data: [1, 2, 3, 4],
      shape: [2, 2],
    });
    const list = await client.tensorList();
    const entries = (list.tensors ?? []) as Array<{ name?: string }>;
    const names = entries.map((e) => e.name).filter(Boolean);
    if (!names.includes("sdk_smoke")) {
      throw new Error(`expected sdk_smoke in tensor list, got ${JSON.stringify(list)}`);
    }
    console.log("smoke OK: tensor_list includes sdk_smoke");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
