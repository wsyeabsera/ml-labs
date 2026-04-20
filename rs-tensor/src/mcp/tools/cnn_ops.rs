use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct Conv2dArgs {
    /// Name of the input tensor in store (shape [N, C_in, H, W])
    pub input: String,
    /// Name of the kernel tensor in store (shape [C_out, C_in, kH, kW])
    pub kernel: String,
    /// Optional name of the bias tensor in store (shape [C_out])
    pub bias: Option<String>,
    /// Stride for both H and W dimensions (default 1)
    pub stride: Option<usize>,
    /// Zero-padding for both H and W dimensions (default 0)
    pub padding: Option<usize>,
    /// Name to store the output tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MaxPool2dArgs {
    /// Name of the input tensor in store (shape [N, C, H, W])
    pub input: String,
    /// Pooling window size (e.g. 2 for 2×2 windows)
    pub kernel_size: usize,
    /// Stride for the pooling window (default = kernel_size)
    pub stride: Option<usize>,
    /// Name to store the output tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AvgPool2dArgs {
    /// Name of the input tensor in store (shape [N, C, H, W])
    pub input: String,
    /// Pooling window size (e.g. 2 for 2×2 windows)
    pub kernel_size: usize,
    /// Stride for the pooling window (default = kernel_size)
    pub stride: Option<usize>,
    /// Name to store the output tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct BatchNorm2dArgs {
    /// Name of the input tensor in store (shape [N, C, H, W])
    pub input: String,
    /// Per-channel scale (gamma), length = C. Use [1.0, ...] for identity.
    pub gamma: Vec<f32>,
    /// Per-channel shift (beta), length = C. Use [0.0, ...] for identity.
    pub beta: Vec<f32>,
    /// Small constant for numerical stability (default 1e-5)
    pub eps: Option<f32>,
    /// Name to store the normalized output tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct FlattenArgs {
    /// Name of the input tensor in store
    pub input: String,
    /// Name to store the flattened output
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GlobalAvgPoolArgs {
    /// Name of the input tensor in store (shape [N, C, H, W])
    pub input: String,
    /// Name to store the output tensor (shape [N, C])
    pub result_name: String,
}

/// A single layer spec in a CNN architecture.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CnnLayerSpec {
    /// Layer type: "conv2d", "relu", "max_pool2d", "avg_pool2d", "flatten", "linear"
    #[serde(rename = "type")]
    pub layer_type: String,
    /// For conv2d: number of input channels
    pub in_channels: Option<usize>,
    /// For conv2d: number of output channels (= number of kernels)
    pub out_channels: Option<usize>,
    /// For conv2d / pool: kernel/window size
    pub kernel_size: Option<usize>,
    /// For conv2d / pool: stride (default 1)
    pub stride: Option<usize>,
    /// For conv2d: zero-padding amount (default 0)
    pub padding: Option<usize>,
    /// For linear: input features
    #[serde(rename = "in")]
    pub in_features: Option<usize>,
    /// For linear: output features
    #[serde(rename = "out")]
    pub out_features: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct InitCnnArgs {
    /// Layer specifications in order. Each has a "type" field.
    pub layers: Vec<CnnLayerSpec>,
    /// Name prefix for the model weights (default: "cnn")
    pub name: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CnnForwardArgs {
    /// Model name prefix (from init_cnn)
    pub model: String,
    /// Name of the input tensor in store (shape [N, C, H, W])
    pub input: String,
}
