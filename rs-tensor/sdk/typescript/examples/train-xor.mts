/**
 * Train a 2→4→1 MLP on the XOR dataset via the rs-tensor MCP server.
 *
 * Run from this directory:
 *   npm run example:xor
 *
 * Requires: Rust toolchain, first run may compile the server (`cargo run --bin mcp`).
 */
import { RsTensorClient, trainXorMlp, defaultMcpStdioParams } from "../src/client.js";
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
    const { dataset, init, training } = await trainXorMlp(client, {
      epochs: 600,
      lr: 0.2,
      hidden: 8,
    });

    console.log("Dataset:", dataset.type, dataset.input_name, "→", dataset.target_name);
    console.log("MLP:", init.architecture.join(" → "), `(${init.total_params} params)`);
    console.log(
      "Training: initial loss",
      training.initial_loss.toFixed(4),
      "→ final",
      training.final_loss.toFixed(4),
    );

    const evalResult = await client.evaluateMlp({
      mlp: init.name,
      inputs: dataset.input_name,
      targets: dataset.target_name,
    });
    console.log("Evaluate:", JSON.stringify(evalResult, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
