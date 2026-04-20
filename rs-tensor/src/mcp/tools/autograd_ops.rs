use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AutogradNeuronArgs {
    /// Input values, e.g. [2.0, 0.0]
    pub inputs: Vec<f32>,
    /// Weights (one per input), e.g. [-3.0, 1.0]
    pub weights: Vec<f32>,
    /// Bias value
    pub bias: f32,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AutogradTensorLayerArgs {
    /// Input data as flat f32 array
    pub input_data: Vec<f32>,
    /// Input shape, e.g. [1, 2] for a 1x2 row vector
    pub input_shape: Vec<usize>,
    /// Weight data as flat f32 array
    pub weight_data: Vec<f32>,
    /// Weight shape, e.g. [2, 1] for a 2x1 matrix
    pub weight_shape: Vec<usize>,
    /// Bias data as flat f32 array
    pub bias_data: Vec<f32>,
    /// Bias shape, e.g. [1, 1]
    pub bias_shape: Vec<usize>,
}

/// A single layer definition for the MLP tool.
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct LayerDef {
    /// Weight data as flat f32 array (row-major)
    pub weights: Vec<f32>,
    /// Bias data as flat f32 array
    pub bias: Vec<f32>,
    /// Number of input features
    pub in_features: usize,
    /// Number of output features
    pub out_features: usize,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MlpForwardArgs {
    /// Input data as flat f32 array
    pub input_data: Vec<f32>,
    /// Input shape, e.g. [1, 2] for a single sample with 2 features
    pub input_shape: Vec<usize>,
    /// Layer definitions in order (first layer receives input, last layer produces output)
    pub layers: Vec<LayerDef>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AttentionArgs {
    /// Query data as flat f32 array
    pub q_data: Vec<f32>,
    /// Key data as flat f32 array
    pub k_data: Vec<f32>,
    /// Value data as flat f32 array
    pub v_data: Vec<f32>,
    /// Sequence length (number of tokens)
    pub seq_len: usize,
    /// Key/query dimension (d_k)
    pub d_k: usize,
    /// Value dimension (d_v). If omitted, defaults to d_k.
    pub d_v: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AutogradExprArgs {
    /// Named scalar values, e.g. [["a", 2.0], ["b", -3.0]]
    pub values: Vec<(String, f32)>,
    /// Operations to execute in order. Each is [result_name, op, arg1, arg2?].
    /// Supported ops: "add", "mul", "tanh".
    /// Examples: ["c", "mul", "a", "b"] or ["d", "tanh", "c"]
    pub ops: Vec<Vec<String>>,
    /// Name of the value to call backward() on
    pub backward_from: String,
}
