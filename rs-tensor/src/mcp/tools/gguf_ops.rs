use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GgufInspectArgs {
    /// Path to the GGUF file (absolute or relative to project dir)
    pub path: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GgufLoadTensorArgs {
    /// Path to the GGUF file
    pub path: String,
    /// Name of the tensor to load from the file
    pub tensor_name: String,
    /// Name to store the tensor under in the server (defaults to tensor_name)
    pub store_as: Option<String>,
}
