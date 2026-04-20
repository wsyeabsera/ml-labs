use rmcp::schemars;
use serde::Deserialize;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LlamaLoadArgs {
    /// Path to the GGUF model file (relative or absolute)
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LlamaGenerateArgs {
    /// Text prompt (will be naive space-split to token IDs, or use token_ids directly)
    #[serde(default)]
    pub prompt: Option<String>,

    /// Raw token IDs to use as prompt (overrides `prompt` text)
    #[serde(default)]
    pub token_ids: Option<Vec<usize>>,

    /// Maximum number of tokens to generate (default: 50)
    #[serde(default = "default_max_tokens")]
    pub max_tokens: usize,

    /// Sampling temperature. 0.0 = greedy (default), >0 = softmax sampling
    #[serde(default)]
    pub temperature: f32,
}

fn default_max_tokens() -> usize {
    50
}
