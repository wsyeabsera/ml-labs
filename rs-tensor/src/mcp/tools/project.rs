use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReadFileArgs {
    /// Path relative to the project root (rs-tensor/)
    pub path: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CargoExecArgs {
    /// Either "build" or "run"
    pub command: String,
}
