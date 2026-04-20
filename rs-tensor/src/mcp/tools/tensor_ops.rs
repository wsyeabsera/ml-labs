use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorCreateArgs {
    /// Name to store the tensor under
    pub name: String,
    /// Flat array of f32 values
    pub data: Vec<f32>,
    /// Shape dimensions, e.g. [2, 2] for a 2x2 matrix
    pub shape: Vec<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorAddArgs {
    /// Name of the first tensor
    pub a: String,
    /// Name of the second tensor
    pub b: String,
    /// Name for the result tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorMulArgs {
    /// Name of the first tensor
    pub a: String,
    /// Name of the second tensor
    pub b: String,
    /// Name for the result tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorGet2dArgs {
    /// Name of the tensor
    pub name: String,
    /// Row index
    pub row: usize,
    /// Column index
    pub col: usize,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorGetArgs {
    /// Name of the tensor
    pub name: String,
    /// N-dimensional indices, e.g. [1, 2] for a 2D tensor or [0, 1, 3] for 3D
    pub indices: Vec<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorReshapeArgs {
    /// Name of the tensor to reshape
    pub name: String,
    /// New shape, e.g. [3, 2]. Product must equal the number of elements.
    pub new_shape: Vec<usize>,
    /// Name for the reshaped tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorTransposeArgs {
    /// Name of the tensor to transpose
    pub name: String,
    /// First dimension to swap (default: 0)
    pub dim0: usize,
    /// Second dimension to swap (default: 1)
    pub dim1: usize,
    /// Name for the transposed tensor
    pub result_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorInspectArgs {
    /// Name of the tensor to inspect
    pub name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TensorMatmulArgs {
    /// Name of the first tensor (2D, shape [M, K])
    pub a: String,
    /// Name of the second tensor (2D, shape [K, N])
    pub b: String,
    /// Name for the result tensor (shape [M, N])
    pub result_name: String,
}
