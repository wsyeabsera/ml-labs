use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateDatasetArgs {
    /// Type of dataset: "and", "or", "xor", "circle", "spiral"
    #[serde(rename = "type")]
    pub dataset_type: String,
    /// Number of samples (only for circle/spiral, default 100)
    pub n_samples: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct InitMlpArgs {
    /// Layer sizes, e.g. [2, 4, 1] for 2 inputs → 4 hidden → 1 output
    pub architecture: Vec<usize>,
    /// Name prefix for the MLP (default: "mlp")
    pub name: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MseLossArgs {
    /// Name of the predicted tensor in store
    pub predicted: String,
    /// Name of the target tensor in store
    pub target: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TrainMlpArgs {
    /// Name prefix of the MLP (from init_mlp)
    pub mlp: String,
    /// Name of input tensor in store
    pub inputs: String,
    /// Name of target tensor in store
    pub targets: String,
    /// Learning rate (e.g. 0.1)
    pub lr: f32,
    /// Number of training epochs
    pub epochs: usize,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct EvaluateMlpArgs {
    /// Name prefix of the MLP
    pub mlp: String,
    /// Name of input tensor in store
    pub inputs: String,
    /// Name of target tensor in store (optional)
    pub targets: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MlpPredictArgs {
    /// Name prefix of the MLP
    pub mlp: String,
    /// Input values for a single sample
    pub input: Vec<f32>,
}
