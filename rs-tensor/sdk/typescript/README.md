# rs-tensor-mcp

TypeScript SDK for the [**rs-tensor**](../../) MCP server: named tensors, element-wise/matrix ops, toy datasets, MLP training (SGD), autograd helpers, scaled dot-product attention, GGUF inspection, and LLaMA load/generate.

## Requirements

- **Node.js** 18+
- **Rust** + **Cargo** (the client spawns `cargo run --quiet --bin mcp` from the `rs-tensor` crate by default)

## Install

From the monorepo:

```bash
cd rs-tensor/sdk/typescript
npm install
npm run build
```

In another project (after `npm pack` or `npm link`):

```bash
npm install /path/to/rs-tensor/sdk/typescript
```

## Quick start

```typescript
import {
  RsTensorClient,
  defaultMcpStdioParams,
  trainXorMlp,
} from "rs-tensor-mcp";

const client = new RsTensorClient({
  transport: {
    ...defaultMcpStdioParams("/absolute/path/to/rs-tensor"),
    cwd: "/absolute/path/to/rs-tensor",
  },
});

await client.connect();
try {
  const { training } = await trainXorMlp(client, { epochs: 500 });
  console.log("final loss", training.final_loss);
} finally {
  await client.close();
}
```

### Environment

| Variable | Purpose |
|----------|---------|
| `RS_TENSOR_ROOT` | Crate root for examples/smoke script (defaults next to this package). |

### Faster server startup

After `cargo build --release --bin mcp`, point the transport at the binary instead of `cargo run`:

```typescript
import { RsTensorClient } from "rs-tensor-mcp";
import { join } from "node:path";

const root = "/path/to/rs-tensor";
const client = new RsTensorClient({
  transport: {
    command: join(root, "target/release/mcp"),
    args: [],
    cwd: root,
    stderr: "inherit",
  },
});
```

*(Create the release binary once; debug binary is `target/debug/mcp`.)*

## API

- **`RsTensorClient`** — `connect()` / `close()`, then one method per MCP tool (`tensorCreate`, `trainMlp`, `llamaGenerate`, …). Success responses are parsed JSON; failures throw **`RsTensorMcpError`**.
- **`trainXorMlp(client, opts?)`** — `create_dataset` (xor) → `init_mlp` [2, hidden, 1] → `train_mlp`.

See tool descriptions in the server: [`src/mcp/tools/mod.rs`](../../src/mcp/tools/mod.rs).

## Examples

```bash
cd rs-tensor/sdk/typescript
npm run example:xor
```

## Unit tests (100% coverage)

```bash
npm test
npm run test:coverage   # enforces 100% lines/branches on src/client.ts + src/index.ts
```

`src/types.ts` is type-only (no runtime code). Integration with a real server: `npm run test:smoke`.

Optional test double: pass `toolCaller: { callTool }` into `RsTensorClient` to mock MCP responses without spawning the binary.

## Smoke test

Spawns the server via `cargo run --bin mcp`, then `tensor_create` and `tensor_list` (asserts the new tensor appears). Set `RS_TENSOR_ROOT` if the crate is not three levels above `scripts/` (default layout: `rs-tensor/sdk/typescript/scripts/` → `rs-tensor/`).

```bash
npm run test:smoke
```

## Learning docs

The MCP server exposes book resources (e.g. `docs://mcp-server`). Browse them from an MCP-enabled client or read the markdown under the main repo’s notes.

## Limitations

Every tensor op is a round-trip over MCP. Fine for small MLPs and experiments; not a replacement for in-process frameworks at scale.
