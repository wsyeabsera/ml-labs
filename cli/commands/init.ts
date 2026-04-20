import { mkdirSync, existsSync, cpSync, writeFileSync, readFileSync } from "node:fs"
import { resolve, join, basename } from "node:path"
import { homedir } from "node:os"
import { rsTensorUrl } from "../lib/config"

const ML_LABS_DIR = join(homedir(), ".ml-labs")

export async function init(target: string) {
  const projectDir = resolve(process.cwd(), target)
  const projectName = target === "." ? basename(projectDir) : target

  console.log(`\nInitializing ML-Labs project: ${projectName}`)
  console.log(`Location: ${projectDir}\n`)

  // Ensure ml-labs is installed
  if (!existsSync(ML_LABS_DIR)) {
    console.error(`ML-Labs not found at ${ML_LABS_DIR}.`)
    console.error(`Run the installer first:`)
    console.error(`  curl -fsSL https://raw.githubusercontent.com/wsyeabsera/ml-labs/main/install.sh | bash`)
    process.exit(1)
  }

  // Create project dir
  mkdirSync(projectDir, { recursive: true })

  const templatesDir = join(ML_LABS_DIR, "cli", "templates")

  // ── .mcp.json ────────────────────────────────────────────────────────────────
  const mcpPath = join(projectDir, ".mcp.json")
  if (!existsSync(mcpPath)) {
    const mcp = {
      mcpServers: {
        "rs-tensor": {
          type: "http",
          url: rsTensorUrl(),
        },
        neuron: {
          command: "bun",
          args: ["run", join(ML_LABS_DIR, "neuron", "src", "server.ts")],
          env: {
            NEURON_DB: join(projectDir, "data", "neuron.db"),
          },
        },
      },
    }
    writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n")
    print_ok(".mcp.json")
  } else {
    print_skip(".mcp.json")
  }

  // ── neuron.config.ts ─────────────────────────────────────────────────────────
  const configPath = join(projectDir, "neuron.config.ts")
  if (!existsSync(configPath)) {
    cpSync(join(templatesDir, "neuron.config.ts"), configPath)
    print_ok("neuron.config.ts")
  } else {
    print_skip("neuron.config.ts")
  }

  // ── .gitignore ───────────────────────────────────────────────────────────────
  const ignorePath = join(projectDir, ".gitignore")
  if (!existsSync(ignorePath)) {
    cpSync(join(templatesDir, "gitignore"), ignorePath)
    print_ok(".gitignore")
  } else {
    print_skip(".gitignore")
  }

  // ── .claude/ skills + commands ───────────────────────────────────────────────
  const claudeSrc = join(ML_LABS_DIR, ".claude")
  const claudeDest = join(projectDir, ".claude")
  mkdirSync(join(claudeDest, "skills"), { recursive: true })
  mkdirSync(join(claudeDest, "commands"), { recursive: true })
  cpSync(join(claudeSrc, "skills"), join(claudeDest, "skills"), { recursive: true, force: false })
  cpSync(join(claudeSrc, "commands"), join(claudeDest, "commands"), { recursive: true, force: false })
  print_ok(".claude/ (skills + commands)")

  // ── tsconfig.json ────────────────────────────────────────────────────────────
  const tsconfigPath = join(projectDir, "tsconfig.json")
  if (!existsSync(tsconfigPath)) {
    const tsconfig = {
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@neuron/mcp/*": [join(ML_LABS_DIR, "neuron", "*")],
        },
      },
    }
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n")
    print_ok("tsconfig.json")
  } else {
    print_skip("tsconfig.json")
  }

  // ── data/ ────────────────────────────────────────────────────────────────────
  const dataDir = join(projectDir, "data")
  mkdirSync(dataDir, { recursive: true })
  const keepPath = join(dataDir, ".gitkeep")
  if (!existsSync(keepPath)) writeFileSync(keepPath, "")
  print_ok("data/")

  // ── examples/ ────────────────────────────────────────────────────────────────
  const examplesDir = join(projectDir, "examples")
  mkdirSync(examplesDir, { recursive: true })
  const examplesSrc = join(templatesDir, "examples")
  if (existsSync(examplesSrc)) {
    cpSync(examplesSrc, examplesDir, { recursive: true, force: false })
    print_ok("examples/  (iris.csv + housing.csv)")
  }

  // ── README.md ────────────────────────────────────────────────────────────────
  const readmePath = join(projectDir, "README.md")
  if (!existsSync(readmePath)) {
    const template = readFileSync(join(templatesDir, "README.md"), "utf-8")
    writeFileSync(readmePath, template.replace(/\{\{PROJECT_NAME\}\}/g, projectName))
    print_ok("README.md")
  } else {
    print_skip("README.md")
  }

  console.log(`
Done! Next steps:

  1. Open ${projectDir} in Claude Code
  2. Claude will pick up the Neuron MCP tools automatically
  3. Load the bundled example or your own data:
       /neuron-load iris examples/iris.csv
  4. Train:
       /neuron-auto iris

  Docs: bun run docs  (at ${ML_LABS_DIR})
`)
}

function print_ok(name: string) {
  console.log(`  ✓  ${name}`)
}
function print_skip(name: string) {
  console.log(`  -  ${name} (already exists, skipped)`)
}
