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
    /// Activation function for hidden layers: "tanh" (default), "relu", "gelu", "leaky_relu".
    /// The output layer is always linear (no activation) regardless of this setting.
    #[serde(default)]
    pub activation: Option<String>,
    /// Weight init strategy: "auto" (default), "xavier", "kaiming".
    /// "auto" picks xavier for tanh, kaiming (He) for relu/gelu/leaky_relu.
    #[serde(default)]
    pub init: Option<String>,
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
    /// Optional L2 weight decay coefficient (default: 0.0 = no decay). Typical values: 1e-4 .. 1e-2.
    #[serde(default)]
    pub weight_decay: Option<f32>,
    /// Optional early-stopping patience in epochs. If set, training stops when loss has not improved
    /// for this many consecutive epochs. Reports epochs_done in the response.
    #[serde(default)]
    pub early_stop_patience: Option<usize>,
    /// Optimizer: "sgd" (default), "adam", "adamw". Adam / AdamW maintain per-weight
    /// first and second moment estimates in the tensor store named `{mlp}_w{l}_m` / `_v`.
    #[serde(default)]
    pub optimizer: Option<String>,
    /// Mini-batch size. Defaults to full-batch. Samples are shuffled per epoch
    /// using `rng_seed` for reproducibility.
    #[serde(default)]
    pub batch_size: Option<usize>,
    /// LR schedule: "constant" (default), "cosine", "linear_warmup".
    /// Cosine decays lr → min_lr over `epochs`. Linear_warmup ramps 0 → lr over `warmup_epochs` then holds.
    #[serde(default)]
    pub lr_schedule: Option<String>,
    /// Warmup epoch count for the "linear_warmup" schedule (default 10).
    #[serde(default)]
    pub warmup_epochs: Option<usize>,
    /// Minimum LR for the cosine schedule (default 0.0).
    #[serde(default)]
    pub min_lr: Option<f32>,
    /// Gradient clipping threshold. If set and the global L2 norm of all parameter gradients
    /// exceeds this value, gradients are scaled down before the update.
    #[serde(default)]
    pub grad_clip: Option<f32>,
    /// Loss function: "mse" (default) or "cross_entropy". Cross-entropy expects raw logits
    /// in the output layer; targets should be one-hot. Classification-only.
    #[serde(default)]
    pub loss: Option<String>,
    /// Seed for the per-epoch shuffle (mini-batch path). When omitted, uses a fixed default
    /// so behavior stays deterministic across runs — override via NEURON_SEED upstream.
    #[serde(default)]
    pub rng_seed: Option<u64>,
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
