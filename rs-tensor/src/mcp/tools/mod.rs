pub mod autograd_ops;
pub mod cnn_ops;
pub mod gguf_ops;
pub mod llama_ops;
pub mod project;
pub mod tensor_ops;
pub mod training_ops;

use std::collections::HashMap;

use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::Parameters,
    model::*,
    tool, tool_router,
};
use serde_json::json;

use super::TensorServer;
use crate::attention::scaled_dot_product_attention;
use crate::autograd::Value;
use crate::cnn;
use crate::gguf::GgufFile;
use crate::llama::{self, LlamaModel};
use crate::mlp::{Layer, MLP};
use crate::tensor::Tensor;
use crate::tensor_value::TensorValue;
use autograd_ops::{
    AttentionArgs, AutogradExprArgs, AutogradNeuronArgs, AutogradTensorLayerArgs, MlpForwardArgs,
};
use cnn_ops::{
    AvgPool2dArgs, BatchNorm2dArgs, CnnForwardArgs, Conv2dArgs, FlattenArgs,
    GlobalAvgPoolArgs, InitCnnArgs, MaxPool2dArgs,
};
use gguf_ops::{GgufInspectArgs, GgufLoadTensorArgs};
use llama_ops::{LlamaLoadArgs, LlamaGenerateArgs};
use project::{CargoExecArgs, ReadFileArgs};
use tensor_ops::{
    TensorAddArgs, TensorCreateArgs, TensorGet2dArgs, TensorGetArgs, TensorInspectArgs,
    TensorMatmulArgs, TensorMulArgs, TensorReshapeArgs, TensorTransposeArgs,
};
use training_ops::{
    CreateDatasetArgs, InitMlpArgs, MseLossArgs, TrainMlpArgs, EvaluateMlpArgs, MlpPredictArgs,
};

#[tool_router(vis = "pub(crate)")]
impl TensorServer {
    #[tool(description = "Create a named tensor from data and shape. Example: data=[1,2,3,4], shape=[2,2]")]
    async fn tensor_create(
        &self,
        Parameters(args): Parameters<TensorCreateArgs>,
    ) -> Result<CallToolResult, McpError> {
        let expected_len: usize = args.shape.iter().product();
        if args.data.len() != expected_len {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Shape {:?} expects {} elements, got {}",
                args.shape, expected_len, args.data.len()
            ))]));
        }

        let t = Tensor::new(args.data, args.shape.clone());
        let result = json!({
            "op": "tensor_create",
            "name": args.name,
            "shape": t.shape,
            "data": t.data,
            "num_elements": t.data.len(),
        });
        self.tensors.lock().await.insert(args.name, t);
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap()
        )]))
    }

    #[tool(description = "Add two named tensors and store the result. Shapes must match.")]
    async fn tensor_add(
        &self,
        Parameters(args): Parameters<TensorAddArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let a = match store.get(&args.a) {
            Some(t) => t,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tensor '{}' not found",
                    args.a
                ))]))
            }
        };
        let b = match store.get(&args.b) {
            Some(t) => t,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tensor '{}' not found",
                    args.b
                ))]))
            }
        };

        if a.shape != b.shape {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Shape mismatch: {:?} vs {:?}",
                a.shape, b.shape
            ))]));
        }

        let result = a.add(b);
        let response = json!({
            "op": "tensor_add",
            "inputs": [args.a, args.b],
            "result_name": args.result_name,
            "shape": result.shape,
            "data": result.data,
        });
        drop(store);
        self.tensors.lock().await.insert(args.result_name, result);
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&response).unwrap()
        )]))
    }

    #[tool(description = "Element-wise multiply two named tensors and store the result. Shapes must match.")]
    async fn tensor_mul(
        &self,
        Parameters(args): Parameters<TensorMulArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let a = match store.get(&args.a) {
            Some(t) => t,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tensor '{}' not found",
                    args.a
                ))]))
            }
        };
        let b = match store.get(&args.b) {
            Some(t) => t,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tensor '{}' not found",
                    args.b
                ))]))
            }
        };

        if a.shape != b.shape {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Shape mismatch: {:?} vs {:?}",
                a.shape, b.shape
            ))]));
        }

        let result = a.mul(b);
        let response = json!({
            "op": "tensor_mul",
            "inputs": [args.a, args.b],
            "result_name": args.result_name,
            "shape": result.shape,
            "data": result.data,
        });
        drop(store);
        self.tensors.lock().await.insert(args.result_name, result);
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&response).unwrap()
        )]))
    }

    #[tool(description = "Matrix multiply two 2D tensors: [M,K] x [K,N] -> [M,N]. Inner dimensions must match.")]
    async fn tensor_matmul(
        &self,
        Parameters(args): Parameters<TensorMatmulArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let a = match store.get(&args.a) {
            Some(t) => t,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tensor '{}' not found",
                    args.a
                ))]))
            }
        };
        let b = match store.get(&args.b) {
            Some(t) => t,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Tensor '{}' not found",
                    args.b
                ))]))
            }
        };

        if a.shape.len() != 2 || b.shape.len() != 2 {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Both tensors must be 2D. Got shapes {:?} and {:?}",
                a.shape, b.shape
            ))]));
        }

        if a.shape[1] != b.shape[0] {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Inner dimensions must match: {}x{} vs {}x{}",
                a.shape[0], a.shape[1], b.shape[0], b.shape[1]
            ))]));
        }

        let result = a.matmul(b);
        let response = json!({
            "op": "tensor_matmul",
            "inputs": [args.a, args.b],
            "result_name": args.result_name,
            "shape": result.shape,
            "data": result.data,
        });
        drop(store);
        self.tensors.lock().await.insert(args.result_name, result);
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&response).unwrap()
        )]))
    }

    #[tool(description = "Get a single element from a 2D tensor by (row, col). Returns the value at that position.")]
    async fn tensor_get_2d(
        &self,
        Parameters(args): Parameters<TensorGet2dArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        match store.get(&args.name) {
            Some(t) => match t.get_2d(args.row, args.col) {
                Some(val) => Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&json!({
                        "op": "tensor_get_2d",
                        "name": args.name,
                        "indices": [args.row, args.col],
                        "value": val,
                    })).unwrap()
                )])),
                None => Ok(CallToolResult::error(vec![Content::text(format!(
                    "Index ({}, {}) out of bounds for shape {:?}",
                    args.row, args.col, t.shape
                ))])),
            },
            None => Ok(CallToolResult::error(vec![Content::text(format!(
                "Tensor '{}' not found",
                args.name
            ))])),
        }
    }

    #[tool(description = "Get a single element by N-dimensional indices. e.g. indices=[1,2] for a 2D tensor.")]
    async fn tensor_get(
        &self,
        Parameters(args): Parameters<TensorGetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        match store.get(&args.name) {
            Some(t) => match t.get(&args.indices) {
                Some(val) => Ok(CallToolResult::success(vec![Content::text(
                    serde_json::to_string_pretty(&json!({
                        "op": "tensor_get",
                        "name": args.name,
                        "indices": args.indices,
                        "value": val,
                    })).unwrap()
                )])),
                None => Ok(CallToolResult::error(vec![Content::text(format!(
                    "Index {:?} out of bounds for shape {:?}",
                    args.indices, t.shape
                ))])),
            },
            None => Ok(CallToolResult::error(vec![Content::text(format!(
                "Tensor '{}' not found",
                args.name
            ))])),
        }
    }

    #[tool(description = "Reshape a tensor to a new shape. Product of new shape must equal the number of elements.")]
    async fn tensor_reshape(
        &self,
        Parameters(args): Parameters<TensorReshapeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        match store.get(&args.name) {
            Some(t) => match t.reshape(args.new_shape.clone()) {
                Some(result) => {
                    let response = json!({
                        "op": "tensor_reshape",
                        "name": args.name,
                        "original_shape": t.shape,
                        "result_name": args.result_name,
                        "shape": result.shape,
                        "data": result.data,
                    });
                    drop(store);
                    self.tensors.lock().await.insert(args.result_name, result);
                    Ok(CallToolResult::success(vec![Content::text(
                        serde_json::to_string_pretty(&response).unwrap()
                    )]))
                }
                None => {
                    let current_size: usize = t.data.len();
                    let new_size: usize = args.new_shape.iter().product();
                    Ok(CallToolResult::error(vec![Content::text(format!(
                        "Cannot reshape: {} elements into shape {:?} ({} elements)",
                        current_size, args.new_shape, new_size
                    ))]))
                }
            },
            None => Ok(CallToolResult::error(vec![Content::text(format!(
                "Tensor '{}' not found",
                args.name
            ))])),
        }
    }

    #[tool(description = "Transpose a tensor by swapping two dimensions. Zero-copy: only swaps shape and strides.")]
    async fn tensor_transpose(
        &self,
        Parameters(args): Parameters<TensorTransposeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        match store.get(&args.name) {
            Some(t) => match t.transpose(args.dim0, args.dim1) {
                Some(result) => {
                    let response = json!({
                        "op": "tensor_transpose",
                        "name": args.name,
                        "dim0": args.dim0,
                        "dim1": args.dim1,
                        "result_name": args.result_name,
                        "shape": result.shape,
                        "strides": result.strides,
                        "data": result.data,
                    });
                    drop(store);
                    self.tensors.lock().await.insert(args.result_name, result);
                    Ok(CallToolResult::success(vec![Content::text(
                        serde_json::to_string_pretty(&response).unwrap()
                    )]))
                }
                None => Ok(CallToolResult::error(vec![Content::text(format!(
                    "Invalid dimensions ({}, {}) for tensor with {} dims",
                    args.dim0, args.dim1, t.shape.len()
                ))])),
            },
            None => Ok(CallToolResult::error(vec![Content::text(format!(
                "Tensor '{}' not found",
                args.name
            ))])),
        }
    }

    #[tool(description = "Inspect a named tensor: shows shape, strides, and data.")]
    async fn tensor_inspect(
        &self,
        Parameters(args): Parameters<TensorInspectArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        match store.get(&args.name) {
            Some(t) => Ok(CallToolResult::success(vec![Content::text(
                serde_json::to_string_pretty(&json!({
                    "op": "tensor_inspect",
                    "name": args.name,
                    "shape": t.shape,
                    "strides": t.strides,
                    "data": t.data,
                    "num_elements": t.data.len(),
                })).unwrap(),
            )])),
            None => Ok(CallToolResult::error(vec![Content::text(format!(
                "Tensor '{}' not found",
                args.name
            ))])),
        }
    }

    #[tool(description = "List all tensors currently stored in memory.")]
    async fn tensor_list(&self) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let tensors: Vec<serde_json::Value> = store
            .iter()
            .map(|(name, t)| {
                json!({
                    "name": name,
                    "shape": t.shape,
                    "num_elements": t.data.len(),
                })
            })
            .collect();
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "tensor_list",
                "count": tensors.len(),
                "tensors": tensors,
            })).unwrap()
        )]))
    }

    #[tool(description = "Read a file from the project directory (logs, JSON output, source code). Path is relative to rs-tensor/.")]
    async fn read_file(
        &self,
        Parameters(args): Parameters<ReadFileArgs>,
    ) -> Result<CallToolResult, McpError> {
        let base = std::env::current_dir().unwrap_or_default();
        let path = base.join(&args.path);

        if !path.starts_with(&base) {
            return Ok(CallToolResult::error(vec![Content::text(
                "Path must be within the project directory.",
            )]));
        }

        match tokio::fs::read_to_string(&path).await {
            Ok(contents) => Ok(CallToolResult::success(vec![Content::text(contents)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to read '{}': {}",
                args.path, e
            ))])),
        }
    }

    #[tool(description = "Run `cargo build` or `cargo run` and return stdout/stderr. command must be 'build' or 'run'.")]
    async fn cargo_exec(
        &self,
        Parameters(args): Parameters<CargoExecArgs>,
    ) -> Result<CallToolResult, McpError> {
        let subcommand = match args.command.as_str() {
            "build" | "run" => args.command.as_str(),
            _ => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "command must be 'build' or 'run'",
                )]))
            }
        };

        let output = tokio::process::Command::new("cargo")
            .arg(subcommand)
            .current_dir(std::env::current_dir().unwrap_or_default())
            .output()
            .await;

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                let status = if out.status.success() {
                    "success"
                } else {
                    "failed"
                };
                Ok(CallToolResult::success(vec![Content::text(format!(
                    "[{}]\n\n--- stdout ---\n{}\n--- stderr ---\n{}",
                    status, stdout, stderr
                ))]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to run cargo: {}",
                e
            ))])),
        }
    }

    // ── Training tools ─────────────────────────────────────────

    #[tool(description = "Create a toy dataset for training. Types: 'and', 'or', 'xor', 'circle', 'spiral'. Stores input and target tensors in the tensor store.")]
    async fn create_dataset(
        &self,
        Parameters(args): Parameters<CreateDatasetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let (inputs, targets, n) = match args.dataset_type.as_str() {
            "and" => (
                vec![0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0],
                vec![0.0, 0.0, 0.0, 1.0],
                4usize,
            ),
            "or" => (
                vec![0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0],
                vec![0.0, 1.0, 1.0, 1.0],
                4,
            ),
            "xor" => (
                vec![0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0],
                vec![0.0, 1.0, 1.0, 0.0],
                4,
            ),
            "circle" => {
                let n = args.n_samples.unwrap_or(100);
                let mut inp = Vec::with_capacity(n * 2);
                let mut tgt = Vec::with_capacity(n);
                for i in 0..n {
                    let angle = (i as f32 / n as f32) * std::f32::consts::TAU;
                    let r = if i % 2 == 0 { 0.5 } else { 1.5 };
                    inp.push(r * angle.cos());
                    inp.push(r * angle.sin());
                    tgt.push(if i % 2 == 0 { 0.0 } else { 1.0 });
                }
                (inp, tgt, n)
            }
            _ => {
                return Ok(CallToolResult::error(vec![Content::text(
                    format!("Unknown dataset type '{}'. Use: and, or, xor, circle", args.dataset_type),
                )]));
            }
        };

        let prefix = format!("{}_", args.dataset_type);
        let input_name = format!("{}inputs", prefix);
        let target_name = format!("{}targets", prefix);

        let input_tensor = Tensor::new(inputs.clone(), vec![n, inputs.len() / n]);
        let target_tensor = Tensor::new(targets.clone(), vec![n, 1]);

        let mut store = self.tensors.lock().await;
        store.insert(input_name.clone(), input_tensor);
        store.insert(target_name.clone(), target_tensor);

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "create_dataset",
                "type": args.dataset_type,
                "n_samples": n,
                "input_name": input_name,
                "input_shape": [n, inputs.len() / n],
                "target_name": target_name,
                "target_shape": [n, 1],
            })).unwrap()
        )]))
    }

    #[tool(description = "Initialize an MLP with random weights. Architecture is a list of layer sizes, e.g. [2, 4, 1]. Stores weight and bias tensors in the tensor store.")]
    async fn init_mlp(
        &self,
        Parameters(args): Parameters<InitMlpArgs>,
    ) -> Result<CallToolResult, McpError> {
        let name = args.name.unwrap_or_else(|| "mlp".to_string());

        if args.architecture.len() < 2 {
            return Ok(CallToolResult::error(vec![Content::text(
                "Architecture must have at least 2 elements (input and output size)".to_string(),
            )]));
        }

        let mut store = self.tensors.lock().await;
        let mut weight_names = Vec::new();
        let mut total_params = 0usize;

        for i in 0..args.architecture.len() - 1 {
            let in_f = args.architecture[i];
            let out_f = args.architecture[i + 1];

            // Xavier initialization: uniform(-limit, limit) where limit = sqrt(6 / (in + out))
            let limit = (6.0 / (in_f + out_f) as f32).sqrt();
            let w_data: Vec<f32> = (0..in_f * out_f)
                .map(|j| {
                    let t = (j as f32 * 0.618033988 + i as f32 * 1.618).fract(); // deterministic pseudo-random
                    t * 2.0 * limit - limit
                })
                .collect();
            let b_data = vec![0.0f32; out_f];

            let w_name = format!("{}_w{}", name, i);
            let b_name = format!("{}_b{}", name, i);

            store.insert(w_name.clone(), Tensor::new(w_data, vec![in_f, out_f]));
            store.insert(b_name.clone(), Tensor::new(b_data, vec![1, out_f]));

            weight_names.push(w_name);
            weight_names.push(b_name);
            total_params += in_f * out_f + out_f;
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "init_mlp",
                "name": name,
                "architecture": args.architecture,
                "layers": args.architecture.len() - 1,
                "total_params": total_params,
                "weight_names": weight_names,
            })).unwrap()
        )]))
    }

    #[tool(description = "Compute mean squared error loss between predicted and target tensors. Returns loss value and gradient.")]
    async fn mse_loss(
        &self,
        Parameters(args): Parameters<MseLossArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let predicted = match store.get(&args.predicted) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(
                format!("Tensor '{}' not found", args.predicted),
            )])),
        };
        let target = match store.get(&args.target) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(
                format!("Tensor '{}' not found", args.target),
            )])),
        };

        if predicted.data.len() != target.data.len() {
            return Ok(CallToolResult::error(vec![Content::text(
                format!("Size mismatch: predicted has {} elements, target has {}",
                    predicted.data.len(), target.data.len()),
            )]));
        }

        let n = predicted.data.len() as f32;
        let loss: f32 = predicted.data.iter().zip(target.data.iter())
            .map(|(p, t)| (p - t).powi(2))
            .sum::<f32>() / n;
        let grad: Vec<f32> = predicted.data.iter().zip(target.data.iter())
            .map(|(p, t)| 2.0 * (p - t) / n)
            .collect();

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "mse_loss",
                "loss": loss,
                "gradient": {
                    "data": grad,
                    "shape": predicted.shape,
                },
            })).unwrap()
        )]))
    }

    #[tool(description = "Train an MLP on a dataset using SGD. Runs forward → MSE loss → backward → weight update for each epoch. Returns training history.")]
    async fn train_mlp(
        &self,
        Parameters(args): Parameters<TrainMlpArgs>,
    ) -> Result<CallToolResult, McpError> {
        let mut store = self.tensors.lock().await;

        // Get dataset
        let inputs = match store.get(&args.inputs) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(
                format!("Input tensor '{}' not found", args.inputs),
            )])),
        };
        let targets = match store.get(&args.targets) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(
                format!("Target tensor '{}' not found", args.targets),
            )])),
        };

        // Figure out how many layers by checking which weight tensors exist
        let mut n_layers = 0;
        while store.contains_key(&format!("{}_w{}", args.mlp, n_layers)) {
            n_layers += 1;
        }
        if n_layers == 0 {
            return Ok(CallToolResult::error(vec![Content::text(
                format!("No MLP weights found with prefix '{}'", args.mlp),
            )]));
        }

        let mut loss_history = Vec::with_capacity(args.epochs);

        for _epoch in 0..args.epochs {

            // Forward pass (all samples at once)
            let mut activations = vec![inputs.clone()]; // activations[0] = input
            let mut pre_activations = Vec::new(); // before tanh

            for l in 0..n_layers {
                let w = store.get(&format!("{}_w{}", args.mlp, l)).unwrap().clone();
                let b = store.get(&format!("{}_b{}", args.mlp, l)).unwrap().clone();
                let prev = activations.last().unwrap();

                // matmul: prev [n_samples, in] @ w [in, out] → [n_samples, out]
                let rows = prev.shape[0];
                let cols = w.shape[1];
                let inner = w.shape[0];
                let mut result = vec![0.0f32; rows * cols];
                for i in 0..rows {
                    for j in 0..cols {
                        let mut sum = 0.0;
                        for k in 0..inner {
                            sum += prev.data[i * inner + k] * w.data[k * cols + j];
                        }
                        result[i * cols + j] = sum + b.data[j]; // add bias
                    }
                }

                pre_activations.push(Tensor::new(result.clone(), vec![rows, cols]));

                // tanh activation
                let activated: Vec<f32> = result.iter().map(|x| x.tanh()).collect();
                activations.push(Tensor::new(activated, vec![rows, cols]));
            }

            // Compute MSE loss
            let output = activations.last().unwrap();
            let n_out = output.data.len() as f32;
            let loss: f32 = output.data.iter().zip(targets.data.iter())
                .map(|(p, t)| (p - t).powi(2))
                .sum::<f32>() / n_out;
            // loss is used below via loss_history

            // Backward pass
            // d_output = 2 * (output - target) / n_out
            let mut grad: Vec<f32> = output.data.iter().zip(targets.data.iter())
                .map(|(p, t)| 2.0 * (p - t) / n_out)
                .collect();
            let mut grad_shape = output.shape.clone();

            for l in (0..n_layers).rev() {
                let w_name = format!("{}_w{}", args.mlp, l);
                let b_name = format!("{}_b{}", args.mlp, l);
                let w = store.get(&w_name).unwrap().clone();
                let prev_act = &activations[l];

                let rows = grad_shape[0];

                // Through tanh: grad *= (1 - activation²)
                let act = &activations[l + 1];
                let tanh_grad: Vec<f32> = grad.iter().zip(act.data.iter())
                    .map(|(g, a)| g * (1.0 - a * a))
                    .collect();

                // Compute weight gradient: prev_act^T @ tanh_grad
                let in_f = w.shape[0];
                let out_f = w.shape[1];
                let mut w_grad = vec![0.0f32; in_f * out_f];
                for i in 0..in_f {
                    for j in 0..out_f {
                        let mut sum = 0.0;
                        for s in 0..rows {
                            sum += prev_act.data[s * in_f + i] * tanh_grad[s * out_f + j];
                        }
                        w_grad[i * out_f + j] = sum;
                    }
                }

                // Compute bias gradient: sum over samples
                let mut b_grad = vec![0.0f32; out_f];
                for s in 0..rows {
                    for j in 0..out_f {
                        b_grad[j] += tanh_grad[s * out_f + j];
                    }
                }

                // Compute input gradient for next layer: tanh_grad @ w^T
                let mut input_grad = vec![0.0f32; rows * in_f];
                for s in 0..rows {
                    for i in 0..in_f {
                        let mut sum = 0.0;
                        for j in 0..out_f {
                            sum += tanh_grad[s * out_f + j] * w.data[i * out_f + j];
                        }
                        input_grad[s * in_f + i] = sum;
                    }
                }

                // SGD update
                let w_tensor = store.get_mut(&w_name).unwrap();
                for i in 0..w_tensor.data.len() {
                    w_tensor.data[i] -= args.lr * w_grad[i];
                }
                w_tensor.grad = Some(w_grad);

                let b_tensor = store.get_mut(&b_name).unwrap();
                for i in 0..b_tensor.data.len() {
                    b_tensor.data[i] -= args.lr * b_grad[i];
                }
                b_tensor.grad = Some(b_grad);

                grad = input_grad;
                grad_shape = vec![rows, in_f];
            }

            loss_history.push(loss);
        }

        // Sample loss history (at most 50 points)
        let sampled: Vec<f32> = if loss_history.len() <= 50 {
            loss_history.clone()
        } else {
            let step = loss_history.len() / 50;
            loss_history.iter().step_by(step).copied().collect()
        };

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "train_mlp",
                "mlp": args.mlp,
                "epochs": args.epochs,
                "initial_loss": loss_history.first().unwrap_or(&0.0),
                "final_loss": loss_history.last().unwrap_or(&0.0),
                "loss_history_sampled": sampled,
                "lr": args.lr,
            })).unwrap()
        )]))
    }

    #[tool(description = "Evaluate an MLP on data without training. Returns predictions, loss, and accuracy.")]
    async fn evaluate_mlp(
        &self,
        Parameters(args): Parameters<EvaluateMlpArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;

        let inputs = match store.get(&args.inputs) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(
                format!("Input tensor '{}' not found", args.inputs),
            )])),
        };

        // Forward pass
        let mut current = inputs.clone();
        let mut l = 0;
        while let Some(w) = store.get(&format!("{}_w{}", args.mlp, l)) {
            let b = store.get(&format!("{}_b{}", args.mlp, l)).unwrap();
            let rows = current.shape[0];
            let cols = w.shape[1];
            let inner = w.shape[0];
            let mut result = vec![0.0f32; rows * cols];
            for i in 0..rows {
                for j in 0..cols {
                    let mut sum = 0.0;
                    for k in 0..inner {
                        sum += current.data[i * inner + k] * w.data[k * cols + j];
                    }
                    result[i * cols + j] = (sum + b.data[j]).tanh();
                }
            }
            current = Tensor::new(result, vec![rows, cols]);
            l += 1;
        }

        let mut response = json!({
            "op": "evaluate_mlp",
            "mlp": args.mlp,
            "predictions": {
                "data": current.data,
                "shape": current.shape,
            },
        });

        if let Some(target_name) = &args.targets {
            if let Some(targets) = store.get(target_name) {
                let n = current.data.len() as f32;
                let loss: f32 = current.data.iter().zip(targets.data.iter())
                    .map(|(p, t)| (p - t).powi(2))
                    .sum::<f32>() / n;

                // Accuracy: round prediction to 0/1, compare to target
                let correct: usize = current.data.iter().zip(targets.data.iter())
                    .filter(|(p, t)| (if **p > 0.5 { 1.0 } else { 0.0 } - *t).abs() < 0.01)
                    .count();
                let accuracy = correct as f32 / current.data.len() as f32;

                response["loss"] = json!(loss);
                response["accuracy"] = json!(accuracy);
            }
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&response).unwrap()
        )]))
    }

    #[tool(description = "Run a single prediction through a trained MLP. Returns the output value.")]
    async fn mlp_predict(
        &self,
        Parameters(args): Parameters<MlpPredictArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;

        let mut current = args.input.clone();
        let mut l = 0;
        while let Some(w) = store.get(&format!("{}_w{}", args.mlp, l)) {
            let b = store.get(&format!("{}_b{}", args.mlp, l)).unwrap();
            let in_f = w.shape[0];
            let out_f = w.shape[1];
            let mut result = vec![0.0f32; out_f];
            for j in 0..out_f {
                let mut sum = 0.0;
                for k in 0..in_f {
                    sum += current[k] * w.data[k * out_f + j];
                }
                result[j] = (sum + b.data[j]).tanh();
            }
            current = result;
            l += 1;
        }

        if l == 0 {
            return Ok(CallToolResult::error(vec![Content::text(
                format!("No MLP weights found with prefix '{}'", args.mlp),
            )]));
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "mlp_predict",
                "mlp": args.mlp,
                "input": args.input,
                "output": current,
                "prediction": if current.len() == 1 {
                    if current[0] > 0.5 { 1 } else { 0 }
                } else { 0 },
            })).unwrap()
        )]))
    }

    // ── Autograd tools ──────────────────────────────────────────

    #[tool(description = "Run a single neuron: out = tanh(sum(inputs[i] * weights[i]) + bias). Returns the output and gradients for all inputs, weights, and bias.")]
    async fn autograd_neuron(
        &self,
        Parameters(args): Parameters<AutogradNeuronArgs>,
    ) -> Result<CallToolResult, McpError> {
        if args.inputs.len() != args.weights.len() {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "inputs length ({}) must match weights length ({})",
                args.inputs.len(),
                args.weights.len()
            ))]));
        }

        // Build the computation graph (all synchronous — no Rc across await)
        let inputs: Vec<Value> = args
            .inputs
            .iter()
            .enumerate()
            .map(|(i, &v)| Value::new(v, &format!("x{}", i)))
            .collect();
        let weights: Vec<Value> = args
            .weights
            .iter()
            .enumerate()
            .map(|(i, &v)| Value::new(v, &format!("w{}", i)))
            .collect();
        let bias = Value::new(args.bias, "b");

        // Forward: sum(xi * wi) + b
        let mut sum = &inputs[0] * &weights[0];
        for i in 1..inputs.len() {
            let prod = &inputs[i] * &weights[i];
            sum = &sum + &prod;
        }
        let pre_activation = &sum + &bias;
        let output = pre_activation.tanh();

        // Backward
        output.backward();

        // Collect results
        let mut results = json!({
            "output": output.data(),
            "output_grad": output.grad(),
            "bias": { "value": bias.data(), "grad": bias.grad() },
        });

        let input_grads: Vec<_> = inputs
            .iter()
            .map(|v| json!({ "value": v.data(), "grad": v.grad() }))
            .collect();
        let weight_grads: Vec<_> = weights
            .iter()
            .map(|v| json!({ "value": v.data(), "grad": v.grad() }))
            .collect();

        results["inputs"] = json!(input_grads);
        results["weights"] = json!(weight_grads);

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&results).unwrap(),
        )]))
    }

    #[tool(description = "Evaluate a custom autograd expression. Define named values, chain operations (add, mul, tanh), then run backward from a specified output. Returns all values with their gradients.")]
    async fn autograd_expr(
        &self,
        Parameters(args): Parameters<AutogradExprArgs>,
    ) -> Result<CallToolResult, McpError> {
        let mut store: HashMap<String, Value> = HashMap::new();

        // Create leaf values
        for (name, data) in &args.values {
            store.insert(name.clone(), Value::new(*data, name));
        }

        // Execute operations
        for op_def in &args.ops {
            if op_def.len() < 3 {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Operation must have at least 3 elements [result, op, arg1], got {:?}",
                    op_def
                ))]));
            }

            let result_name = &op_def[0];
            let op = &op_def[1];
            let arg1_name = &op_def[2];

            let arg1 = match store.get(arg1_name) {
                Some(v) => v.clone(),
                None => {
                    return Ok(CallToolResult::error(vec![Content::text(format!(
                        "Value '{}' not found",
                        arg1_name
                    ))]))
                }
            };

            let result = match op.as_str() {
                "add" => {
                    if op_def.len() < 4 {
                        return Ok(CallToolResult::error(vec![Content::text(
                            "add requires two arguments: [result, \"add\", a, b]".to_string(),
                        )]));
                    }
                    let arg2 = match store.get(&op_def[3]) {
                        Some(v) => v.clone(),
                        None => {
                            return Ok(CallToolResult::error(vec![Content::text(format!(
                                "Value '{}' not found",
                                op_def[3]
                            ))]))
                        }
                    };
                    &arg1 + &arg2
                }
                "mul" => {
                    if op_def.len() < 4 {
                        return Ok(CallToolResult::error(vec![Content::text(
                            "mul requires two arguments: [result, \"mul\", a, b]".to_string(),
                        )]));
                    }
                    let arg2 = match store.get(&op_def[3]) {
                        Some(v) => v.clone(),
                        None => {
                            return Ok(CallToolResult::error(vec![Content::text(format!(
                                "Value '{}' not found",
                                op_def[3]
                            ))]))
                        }
                    };
                    &arg1 * &arg2
                }
                "tanh" => arg1.tanh(),
                _ => {
                    return Ok(CallToolResult::error(vec![Content::text(format!(
                        "Unknown op '{}'. Supported: add, mul, tanh",
                        op
                    ))]))
                }
            };

            store.insert(result_name.clone(), result);
        }

        // Run backward
        match store.get(&args.backward_from) {
            Some(v) => v.backward(),
            None => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Value '{}' not found for backward",
                    args.backward_from
                ))]))
            }
        }

        // Collect all values with gradients
        let mut results: Vec<serde_json::Value> = Vec::new();
        // Show leaf values first, then computed values
        for (name, _) in &args.values {
            if let Some(v) = store.get(name) {
                results.push(json!({
                    "name": name,
                    "data": v.data(),
                    "grad": v.grad(),
                }));
            }
        }
        for op_def in &args.ops {
            let name = &op_def[0];
            if let Some(v) = store.get(name) {
                results.push(json!({
                    "name": name,
                    "data": v.data(),
                    "grad": v.grad(),
                }));
            }
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({ "values": results })).unwrap(),
        )]))
    }

    // ── Tensor-level autograd tools ─────────────────────────────

    #[tool(description = "Run a tensor-level neural network layer: out = tanh(x @ w + b). Returns output and gradients for x, w, and b. Uses TensorValue autograd for matrix operations.")]
    async fn autograd_neuron_tensor(
        &self,
        Parameters(args): Parameters<AutogradTensorLayerArgs>,
    ) -> Result<CallToolResult, McpError> {
        // Validate shapes
        let x_size: usize = args.input_shape.iter().product();
        let w_size: usize = args.weight_shape.iter().product();
        let b_size: usize = args.bias_shape.iter().product();

        if args.input_data.len() != x_size {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Input shape {:?} expects {} elements, got {}",
                args.input_shape, x_size, args.input_data.len()
            ))]));
        }
        if args.weight_data.len() != w_size {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Weight shape {:?} expects {} elements, got {}",
                args.weight_shape, w_size, args.weight_data.len()
            ))]));
        }
        if args.bias_data.len() != b_size {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Bias shape {:?} expects {} elements, got {}",
                args.bias_shape, b_size, args.bias_data.len()
            ))]));
        }

        // Build TensorValues and run forward + backward (all synchronous, no Rc across await)
        let x = TensorValue::new(Tensor::new(args.input_data, args.input_shape), "x");
        let w = TensorValue::new(Tensor::new(args.weight_data, args.weight_shape), "w");
        let b = TensorValue::new(Tensor::new(args.bias_data, args.bias_shape), "b");

        let xw = x.matmul(&w);
        let pre = xw.add(&b);
        let out = pre.tanh();
        out.backward();

        let result = json!({
            "output": {
                "data": out.data().data,
                "shape": out.data().shape,
            },
            "x": {
                "data": x.data().data,
                "shape": x.data().shape,
                "grad": x.grad().data,
            },
            "w": {
                "data": w.data().data,
                "shape": w.data().shape,
                "grad": w.grad().data,
            },
            "b": {
                "data": b.data().data,
                "shape": b.data().shape,
                "grad": b.grad().data,
            },
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap(),
        )]))
    }

    #[tool(description = "Run a multi-layer perceptron (feedforward network) forward pass with backward. Each layer computes tanh(x @ w + b). Returns the output and gradients for all layer weights and biases.")]
    async fn mlp_forward(
        &self,
        Parameters(args): Parameters<MlpForwardArgs>,
    ) -> Result<CallToolResult, McpError> {
        // Validate input
        let x_size: usize = args.input_shape.iter().product();
        if args.input_data.len() != x_size {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Input shape {:?} expects {} elements, got {}",
                args.input_shape, x_size, args.input_data.len()
            ))]));
        }

        if args.layers.is_empty() {
            return Ok(CallToolResult::error(vec![Content::text(
                "MLP must have at least one layer".to_string(),
            )]));
        }

        // Validate each layer's dimensions
        for (i, layer_def) in args.layers.iter().enumerate() {
            let expected_w = layer_def.in_features * layer_def.out_features;
            if layer_def.weights.len() != expected_w {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Layer {} weights: expected {} elements ({}x{}), got {}",
                    i, expected_w, layer_def.in_features, layer_def.out_features, layer_def.weights.len()
                ))]));
            }
            if layer_def.bias.len() != layer_def.out_features {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Layer {} bias: expected {} elements, got {}",
                    i, layer_def.out_features, layer_def.bias.len()
                ))]));
            }
        }

        // Validate layer connectivity
        let first_in = args.layers[0].in_features;
        if args.input_shape.len() == 2 && args.input_shape[1] != first_in {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Input has {} features but first layer expects {}",
                args.input_shape[1], first_in
            ))]));
        }
        for i in 1..args.layers.len() {
            if args.layers[i - 1].out_features != args.layers[i].in_features {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Layer {} outputs {} features but layer {} expects {}",
                    i - 1, args.layers[i - 1].out_features, i, args.layers[i].in_features
                ))]));
            }
        }

        // Build and run the MLP (all synchronous — no Rc across await)
        let layers: Vec<Layer> = args
            .layers
            .iter()
            .enumerate()
            .map(|(i, def)| {
                Layer::new(
                    def.weights.clone(),
                    def.bias.clone(),
                    def.in_features,
                    def.out_features,
                    &format!("L{}", i),
                )
            })
            .collect();

        let mlp = MLP::new(layers);
        let x = TensorValue::new(Tensor::new(args.input_data, args.input_shape), "x");
        let out = mlp.forward(&x);
        out.backward();

        // Collect results
        let mut layer_results = Vec::new();
        for (i, layer) in mlp.layers.iter().enumerate() {
            layer_results.push(json!({
                "layer": i,
                "w": {
                    "shape": layer.w.data().shape,
                    "data": layer.w.data().data,
                    "grad": layer.w.grad().data,
                },
                "b": {
                    "shape": layer.b.data().shape,
                    "data": layer.b.data().data,
                    "grad": layer.b.grad().data,
                },
            }));
        }

        let result = json!({
            "output": {
                "data": out.data().data,
                "shape": out.data().shape,
            },
            "input_grad": x.grad().data,
            "layers": layer_results,
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap(),
        )]))
    }

    // ── Attention tools ─────────────────────────────────────────

    #[tool(description = "Run scaled dot-product attention: softmax(Q @ K^T / sqrt(d_k)) @ V. Returns the output, attention weights, and gradients for Q, K, V.")]
    async fn attention_forward(
        &self,
        Parameters(args): Parameters<AttentionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let d_v = args.d_v.unwrap_or(args.d_k);

        // Validate sizes
        let q_expected = args.seq_len * args.d_k;
        let k_expected = args.seq_len * args.d_k;
        let v_expected = args.seq_len * d_v;

        if args.q_data.len() != q_expected {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "Q: expected {} elements ({}x{}), got {}",
                q_expected, args.seq_len, args.d_k, args.q_data.len()
            ))]));
        }
        if args.k_data.len() != k_expected {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "K: expected {} elements ({}x{}), got {}",
                k_expected, args.seq_len, args.d_k, args.k_data.len()
            ))]));
        }
        if args.v_data.len() != v_expected {
            return Ok(CallToolResult::error(vec![Content::text(format!(
                "V: expected {} elements ({}x{}), got {}",
                v_expected, args.seq_len, d_v, args.v_data.len()
            ))]));
        }

        let q = TensorValue::new(
            Tensor::new(args.q_data, vec![args.seq_len, args.d_k]),
            "Q",
        );
        let k = TensorValue::new(
            Tensor::new(args.k_data, vec![args.seq_len, args.d_k]),
            "K",
        );
        let v = TensorValue::new(
            Tensor::new(args.v_data, vec![args.seq_len, d_v]),
            "V",
        );

        let (output, weights) = scaled_dot_product_attention(&q, &k, &v);

        // Run backward from sum of output to get gradients
        let loss = output.sum();
        loss.backward();

        let result = json!({
            "output": {
                "data": output.data().data,
                "shape": output.data().shape,
            },
            "attention_weights": {
                "data": weights.data().data,
                "shape": weights.data().shape,
            },
            "Q_grad": q.grad().data,
            "K_grad": k.grad().data,
            "V_grad": v.grad().data,
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap(),
        )]))
    }

    // ── GGUF tools ──────────────────────────────────────────────

    #[tool(description = "Inspect a GGUF model file: shows version, metadata, architecture, and lists all tensors with shapes and dtypes.")]
    async fn gguf_inspect(
        &self,
        Parameters(args): Parameters<GgufInspectArgs>,
    ) -> Result<CallToolResult, McpError> {
        let path = std::path::Path::new(&args.path);
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to open '{}': {}",
                    args.path, e
                ))]))
            }
        };

        let reader = std::io::BufReader::new(file);
        let gguf = match GgufFile::parse(reader) {
            Ok(g) => g,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to parse GGUF: {}",
                    e
                ))]))
            }
        };

        let summary = gguf.summary();
        let tensors = gguf.list_tensors();

        // Show key metadata
        let mut meta_lines = Vec::new();
        let interesting_keys = [
            "general.architecture",
            "general.name",
            "general.file_type",
            "general.quantization_version",
        ];
        for key in &interesting_keys {
            if let Some(val) = gguf.metadata.get(*key) {
                meta_lines.push(format!("  {}: {:?}", key, val));
            }
        }
        // Also show any architecture-specific keys
        if let Some(arch) = gguf
            .metadata
            .get("general.architecture")
            .and_then(|v| v.as_str())
        {
            for (key, val) in &gguf.metadata {
                if key.starts_with(&format!("{}.", arch)) {
                    meta_lines.push(format!("  {}: {:?}", key, val));
                }
            }
        }

        let tensor_list = if tensors.len() > 50 {
            let mut lines: Vec<String> = tensors.iter().take(25).cloned().collect();
            lines.push(format!("  ... ({} more tensors)", tensors.len() - 50));
            lines.extend(tensors.iter().rev().take(25).rev().cloned());
            lines
        } else {
            tensors
        };

        let result = format!(
            "{}\n\nMetadata:\n{}\n\nTensors ({}):\n{}",
            summary,
            meta_lines.join("\n"),
            tensor_list.len(),
            tensor_list
                .iter()
                .map(|t| format!("  {}", t))
                .collect::<Vec<_>>()
                .join("\n")
        );

        Ok(CallToolResult::success(vec![Content::text(result)]))
    }

    #[tool(description = "Load a tensor from a GGUF file into the tensor store. Supports F32 and F16 tensors (F16 is converted to F32).")]
    async fn gguf_load_tensor(
        &self,
        Parameters(args): Parameters<GgufLoadTensorArgs>,
    ) -> Result<CallToolResult, McpError> {
        let path = std::path::Path::new(&args.path);
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to open '{}': {}",
                    args.path, e
                ))]))
            }
        };

        let reader = std::io::BufReader::new(file);
        let mut gguf = match GgufFile::parse(reader) {
            Ok(g) => g,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to parse GGUF: {}",
                    e
                ))]))
            }
        };

        let tensor = match gguf.load_tensor(&args.tensor_name) {
            Ok(t) => t,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to load tensor '{}': {}",
                    args.tensor_name, e
                ))]))
            }
        };

        let store_name = args.store_as.unwrap_or(args.tensor_name.clone());
        let info = format!(
            "Loaded '{}' from GGUF -> '{}': shape={:?}, {} elements",
            args.tensor_name,
            store_name,
            tensor.shape,
            tensor.data.len()
        );
        self.tensors.lock().await.insert(store_name, tensor);

        Ok(CallToolResult::success(vec![Content::text(info)]))
    }

    // ── LLaMA inference tools ──────────────────────────────────

    #[tool(description = "Load a LLaMA model from a GGUF file. Extracts the vocabulary and stores the model in server state for generation. Only one model can be loaded at a time.")]
    async fn llama_load(
        &self,
        Parameters(args): Parameters<LlamaLoadArgs>,
    ) -> Result<CallToolResult, McpError> {
        let path = std::path::Path::new(&args.path);
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to open '{}': {}",
                    args.path, e
                ))]))
            }
        };

        let reader = std::io::BufReader::new(file);
        let mut gguf = match GgufFile::parse(reader) {
            Ok(g) => g,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to parse GGUF: {}",
                    e
                ))]))
            }
        };

        // Extract vocab before loading model (needs shared borrow of gguf)
        let vocab = llama::extract_vocab(&gguf);
        let vocab_len = vocab.len();

        let model = match LlamaModel::from_gguf(&mut gguf) {
            Ok(m) => m,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Failed to load model: {}",
                    e
                ))]))
            }
        };

        let info = format!(
            "Model loaded from '{}':\n  dim={}, layers={}, heads={} (kv={}), vocab={}, ffn={}\n  head_dim={}, rms_eps={}\n  Vocabulary: {} tokens",
            args.path,
            model.config.dim,
            model.config.n_layers,
            model.config.n_heads,
            model.config.n_kv_heads,
            model.config.vocab_size,
            model.config.ffn_dim,
            model.config.head_dim,
            model.config.rms_eps,
            vocab_len,
        );

        *self.model.lock().await = Some(model);
        *self.vocab.lock().await = vocab;

        Ok(CallToolResult::success(vec![Content::text(info)]))
    }

    #[tool(description = "Generate text from the loaded LLaMA model. Provide either a text prompt (naive whitespace tokenization) or raw token_ids. Returns generated text and token IDs. Model must be loaded first with llama_load.")]
    async fn llama_generate(
        &self,
        Parameters(args): Parameters<LlamaGenerateArgs>,
    ) -> Result<CallToolResult, McpError> {
        let model_guard = self.model.lock().await;
        let model = match model_guard.as_ref() {
            Some(m) => m,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "No model loaded. Use llama_load first.",
                )]))
            }
        };

        let vocab = self.vocab.lock().await;

        // Determine prompt tokens
        let prompt_tokens = if let Some(ref ids) = args.token_ids {
            ids.clone()
        } else if let Some(ref text) = args.prompt {
            if vocab.is_empty() {
                return Ok(CallToolResult::error(vec![Content::text(
                    "No vocabulary loaded. Cannot tokenize text prompt. Use token_ids instead.",
                )]));
            }
            // Naive: look up each word in vocab, fall back to BOS token
            let bos = 1usize;
            let mut tokens = vec![bos];
            for word in text.split_whitespace() {
                if let Some(pos) = vocab.iter().position(|v| v == word) {
                    tokens.push(pos);
                }
                // Skip unknown words (simplistic — real tokenizer would do subword)
            }
            tokens
        } else {
            // Default: just BOS
            vec![1]
        };

        if prompt_tokens.is_empty() {
            return Ok(CallToolResult::error(vec![Content::text(
                "No prompt tokens. Provide prompt text or token_ids.",
            )]));
        }

        // Validate token IDs
        for &t in &prompt_tokens {
            if t >= model.config.vocab_size {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Token ID {} exceeds vocab size {}",
                    t, model.config.vocab_size
                ))]));
            }
        }

        let start = std::time::Instant::now();
        let generated = model.generate(&prompt_tokens, args.max_tokens, args.temperature);
        let elapsed = start.elapsed();

        let text = if !vocab.is_empty() {
            llama::decode_tokens(&vocab, &generated)
        } else {
            format!("{:?}", generated)
        };

        let tok_per_sec = generated.len() as f64 / elapsed.as_secs_f64();

        let result = json!({
            "text": text,
            "token_ids": generated,
            "prompt_tokens": prompt_tokens,
            "num_generated": generated.len(),
            "elapsed_ms": elapsed.as_millis(),
            "tokens_per_sec": format!("{:.1}", tok_per_sec),
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap(),
        )]))
    }

    #[tool(description = "Inspect the currently loaded LLaMA model: shows config, architecture details, weight shapes, and vocabulary sample.")]
    async fn llama_inspect(
        &self,
    ) -> Result<CallToolResult, McpError> {
        let model_guard = self.model.lock().await;
        let model = match model_guard.as_ref() {
            Some(m) => m,
            None => {
                return Ok(CallToolResult::error(vec![Content::text(
                    "No model loaded. Use llama_load first.",
                )]))
            }
        };

        let vocab = self.vocab.lock().await;
        let cfg = &model.config;

        let mut block_info = Vec::new();
        for (i, block) in model.blocks.iter().enumerate() {
            block_info.push(json!({
                "layer": i,
                "attn_q": block.attn_q.shape,
                "attn_k": block.attn_k.shape,
                "attn_v": block.attn_v.shape,
                "attn_output": block.attn_output.shape,
                "attn_norm": block.attn_norm.shape,
                "ffn_gate": block.ffn_gate.shape,
                "ffn_down": block.ffn_down.shape,
                "ffn_up": block.ffn_up.shape,
                "ffn_norm": block.ffn_norm.shape,
            }));
        }

        // Sample some vocab entries
        let vocab_sample: Vec<String> = vocab.iter().take(20).cloned().collect();
        let vocab_end: Vec<String> = if vocab.len() > 20 {
            vocab.iter().rev().take(5).rev().cloned().collect()
        } else {
            vec![]
        };

        // Count total parameters
        let mut total_params: usize = model.token_embd.data.len() + model.output.data.len() + model.output_norm.data.len();
        for block in &model.blocks {
            total_params += block.attn_q.data.len()
                + block.attn_k.data.len()
                + block.attn_v.data.len()
                + block.attn_output.data.len()
                + block.attn_norm.data.len()
                + block.ffn_gate.data.len()
                + block.ffn_down.data.len()
                + block.ffn_up.data.len()
                + block.ffn_norm.data.len();
        }

        let result = json!({
            "config": {
                "dim": cfg.dim,
                "n_layers": cfg.n_layers,
                "n_heads": cfg.n_heads,
                "n_kv_heads": cfg.n_kv_heads,
                "vocab_size": cfg.vocab_size,
                "ffn_dim": cfg.ffn_dim,
                "head_dim": cfg.head_dim,
                "rms_eps": cfg.rms_eps,
            },
            "total_parameters": total_params,
            "total_parameters_human": format!("{:.1}M", total_params as f64 / 1_000_000.0),
            "weight_shapes": {
                "token_embd": model.token_embd.shape,
                "output": model.output.shape,
                "output_norm": model.output_norm.shape,
            },
            "blocks": block_info,
            "vocab_size": vocab.len(),
            "vocab_sample_first_20": vocab_sample,
            "vocab_sample_last_5": vocab_end,
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap(),
        )]))
    }

    // ── CNN tools ────────────────────────────────────────────────

    #[tool(description = "2D convolution: slide kernels over an image to produce feature maps. Input shape [N,C_in,H,W], kernel shape [C_out,C_in,kH,kW]. Returns output shape [N,C_out,out_H,out_W].")]
    async fn conv2d_forward(
        &self,
        Parameters(args): Parameters<Conv2dArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;

        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };
        let kernel = match store.get(&args.kernel) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.kernel))])),
        };
        let bias = match &args.bias {
            Some(name) => match store.get(name) {
                Some(t) => Some(t.clone()),
                None => return Ok(CallToolResult::error(vec![Content::text(format!("Bias tensor '{}' not found", name))])),
            },
            None => None,
        };
        drop(store);

        let stride  = args.stride.unwrap_or(1);
        let padding = args.padding.unwrap_or(0);

        match cnn::conv2d(&input, &kernel, bias.as_ref(), stride, padding) {
            Ok(result) => {
                let response = json!({
                    "op": "conv2d_forward",
                    "input_shape": input.shape,
                    "kernel_shape": kernel.shape,
                    "stride": stride,
                    "padding": padding,
                    "result_name": args.result_name,
                    "output_shape": result.shape,
                    "output_data": result.data,
                });
                self.tensors.lock().await.insert(args.result_name, result);
                Ok(CallToolResult::success(vec![Content::text(serde_json::to_string_pretty(&response).unwrap())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "2D max pooling: take the maximum value in each kernel_size×kernel_size window. Reduces spatial size. Input [N,C,H,W] → output [N,C,out_H,out_W]. Also returns argmax indices for the backward pass.")]
    async fn max_pool2d(
        &self,
        Parameters(args): Parameters<MaxPool2dArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };
        drop(store);

        let stride = args.stride.unwrap_or(args.kernel_size);

        match cnn::max_pool2d(&input, args.kernel_size, stride) {
            Ok(res) => {
                let response = json!({
                    "op": "max_pool2d",
                    "input_shape": input.shape,
                    "kernel_size": args.kernel_size,
                    "stride": stride,
                    "result_name": args.result_name,
                    "output_shape": res.output.shape,
                    "output_data": res.output.data,
                    "argmax": res.argmax,
                });
                self.tensors.lock().await.insert(args.result_name, res.output);
                Ok(CallToolResult::success(vec![Content::text(serde_json::to_string_pretty(&response).unwrap())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "2D average pooling: take the mean value in each kernel_size×kernel_size window. Input [N,C,H,W] → output [N,C,out_H,out_W].")]
    async fn avg_pool2d(
        &self,
        Parameters(args): Parameters<AvgPool2dArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };
        drop(store);

        let stride = args.stride.unwrap_or(args.kernel_size);

        match cnn::avg_pool2d(&input, args.kernel_size, stride) {
            Ok(result) => {
                let response = json!({
                    "op": "avg_pool2d",
                    "input_shape": input.shape,
                    "kernel_size": args.kernel_size,
                    "stride": stride,
                    "result_name": args.result_name,
                    "output_shape": result.shape,
                    "output_data": result.data,
                });
                self.tensors.lock().await.insert(args.result_name, result);
                Ok(CallToolResult::success(vec![Content::text(serde_json::to_string_pretty(&response).unwrap())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "Batch normalization for conv layers: normalize each channel across batch+spatial dims, then apply learned gamma (scale) and beta (shift). Input [N,C,H,W], gamma/beta length=C.")]
    async fn batch_norm2d(
        &self,
        Parameters(args): Parameters<BatchNorm2dArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };
        drop(store);

        let eps = args.eps.unwrap_or(1e-5);

        match cnn::batch_norm2d(&input, &args.gamma, &args.beta, eps) {
            Ok(result) => {
                let response = json!({
                    "op": "batch_norm2d",
                    "input_shape": input.shape,
                    "gamma": args.gamma,
                    "beta": args.beta,
                    "eps": eps,
                    "result_name": args.result_name,
                    "output_shape": result.shape,
                    "output_data": result.data,
                });
                self.tensors.lock().await.insert(args.result_name, result);
                Ok(CallToolResult::success(vec![Content::text(serde_json::to_string_pretty(&response).unwrap())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "Flatten a 4D tensor [N,C,H,W] to [N, C*H*W]. Bridges conv layers to fully-connected layers.")]
    async fn flatten_tensor(
        &self,
        Parameters(args): Parameters<FlattenArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };
        drop(store);

        if input.shape.len() < 2 {
            return Ok(CallToolResult::error(vec![Content::text(
                format!("flatten_tensor: need at least 2D tensor, got {:?}", input.shape)
            )]));
        }

        let n = input.shape[0];
        let rest: usize = input.shape[1..].iter().product();
        match input.reshape(vec![n, rest]) {
            Some(result) => {
                let response = json!({
                    "op": "flatten_tensor",
                    "input_shape": input.shape,
                    "result_name": args.result_name,
                    "output_shape": result.shape,
                    "output_data": result.data,
                });
                self.tensors.lock().await.insert(args.result_name, result);
                Ok(CallToolResult::success(vec![Content::text(serde_json::to_string_pretty(&response).unwrap())]))
            }
            None => Ok(CallToolResult::error(vec![Content::text("flatten_tensor: reshape failed".to_string())])),
        }
    }

    #[tool(description = "Global average pooling: collapse H and W by averaging, output shape [N, C]. Used before the final classifier to make the model size-independent.")]
    async fn global_avg_pool(
        &self,
        Parameters(args): Parameters<GlobalAvgPoolArgs>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.tensors.lock().await;
        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };
        drop(store);

        match cnn::global_avg_pool2d(&input) {
            Ok(result) => {
                let response = json!({
                    "op": "global_avg_pool",
                    "input_shape": input.shape,
                    "result_name": args.result_name,
                    "output_shape": result.shape,
                    "output_data": result.data,
                });
                self.tensors.lock().await.insert(args.result_name, result);
                Ok(CallToolResult::success(vec![Content::text(serde_json::to_string_pretty(&response).unwrap())]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "Initialize a CNN model from a layer spec. Supported layer types: 'conv2d' (in_channels, out_channels, kernel_size, stride?, padding?), 'relu', 'max_pool2d' (kernel_size, stride?), 'avg_pool2d' (kernel_size, stride?), 'flatten', 'linear' (in, out). Stores random weights in the tensor store.")]
    async fn init_cnn(
        &self,
        Parameters(args): Parameters<InitCnnArgs>,
    ) -> Result<CallToolResult, McpError> {
        let name = args.name.clone().unwrap_or_else(|| "cnn".to_string());
        let mut store = self.tensors.lock().await;
        let mut weight_names: Vec<String> = Vec::new();
        let mut layer_info: Vec<serde_json::Value> = Vec::new();
        let mut total_params = 0usize;
        let mut param_idx = 0usize;

        // Simple LCG for reproducible random init (same approach as init_mlp)
        let mut rng_state: u64 = 42;
        let mut next_f32 = move || -> f32 {
            rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let bits = (rng_state >> 33) as u32;
            let f = f32::from_bits((bits >> 9) | 0x3f800000) - 1.0;
            f * 2.0 - 1.0 // [-1, 1]
        };

        for layer in &args.layers {
            match layer.layer_type.as_str() {
                "conv2d" => {
                    let c_in = match layer.in_channels {
                        Some(v) => v,
                        None => return Ok(CallToolResult::error(vec![Content::text("conv2d layer requires 'in_channels'")])),
                    };
                    let c_out = match layer.out_channels {
                        Some(v) => v,
                        None => return Ok(CallToolResult::error(vec![Content::text("conv2d layer requires 'out_channels'")])),
                    };
                    let k = match layer.kernel_size {
                        Some(v) => v,
                        None => return Ok(CallToolResult::error(vec![Content::text("conv2d layer requires 'kernel_size'")])),
                    };

                    // He init: scale = sqrt(2 / fan_in) where fan_in = C_in * kH * kW
                    let fan_in = c_in * k * k;
                    let scale = (2.0 / fan_in as f32).sqrt();

                    let w_name = format!("{}_conv{}_weight", name, param_idx);
                    let b_name = format!("{}_conv{}_bias", name, param_idx);

                    let w_data: Vec<f32> = (0..c_out * c_in * k * k).map(|_| next_f32() * scale).collect();
                    let b_data: Vec<f32> = vec![0.0; c_out];

                    total_params += w_data.len() + b_data.len();
                    store.insert(w_name.clone(), Tensor::new(w_data, vec![c_out, c_in, k, k]));
                    store.insert(b_name.clone(), Tensor::new(b_data, vec![c_out]));
                    weight_names.extend([w_name.clone(), b_name.clone()]);

                    layer_info.push(json!({
                        "type": "conv2d",
                        "in_channels": c_in, "out_channels": c_out, "kernel_size": k,
                        "stride": layer.stride.unwrap_or(1),
                        "padding": layer.padding.unwrap_or(0),
                        "weight_name": w_name, "bias_name": b_name,
                    }));
                    param_idx += 1;
                }
                "linear" => {
                    let in_f = match layer.in_features {
                        Some(v) => v,
                        None => return Ok(CallToolResult::error(vec![Content::text("linear layer requires 'in' (in_features)")])),
                    };
                    let out_f = match layer.out_features {
                        Some(v) => v,
                        None => return Ok(CallToolResult::error(vec![Content::text("linear layer requires 'out' (out_features)")])),
                    };
                    let limit = (6.0 / (in_f + out_f) as f32).sqrt();

                    let w_name = format!("{}_fc{}_weight", name, param_idx);
                    let b_name = format!("{}_fc{}_bias", name, param_idx);

                    let w_data: Vec<f32> = (0..in_f * out_f).map(|_| next_f32() * limit).collect();
                    let b_data = vec![0.0f32; out_f];

                    total_params += w_data.len() + b_data.len();
                    store.insert(w_name.clone(), Tensor::new(w_data, vec![in_f, out_f]));
                    store.insert(b_name.clone(), Tensor::new(b_data, vec![out_f]));
                    weight_names.extend([w_name.clone(), b_name.clone()]);

                    layer_info.push(json!({
                        "type": "linear",
                        "in_features": in_f, "out_features": out_f,
                        "weight_name": w_name, "bias_name": b_name,
                    }));
                    param_idx += 1;
                }
                t @ ("relu" | "max_pool2d" | "avg_pool2d" | "flatten") => {
                    layer_info.push(json!({
                        "type": t,
                        "kernel_size": layer.kernel_size,
                        "stride": layer.stride,
                    }));
                }
                other => {
                    return Ok(CallToolResult::error(vec![Content::text(format!(
                        "Unknown layer type '{}'. Use: conv2d, relu, max_pool2d, avg_pool2d, flatten, linear", other
                    ))]));
                }
            }
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "init_cnn",
                "name": name,
                "layers": layer_info,
                "total_params": total_params,
                "weight_names": weight_names,
            })).unwrap()
        )]))
    }

    #[tool(description = "Run a forward pass through an initialized CNN. Executes conv2d → relu → pool → flatten → linear layers in order, returning output and intermediate feature maps for each layer.")]
    async fn cnn_forward(
        &self,
        Parameters(args): Parameters<CnnForwardArgs>,
    ) -> Result<CallToolResult, McpError> {
        use crate::cnn::{conv2d, max_pool2d, relu};

        let store = self.tensors.lock().await;

        // Collect model layer specs from the store metadata (re-derive from weight names)
        // We'll walk all tensors with the model prefix to determine layer order.
        // Strategy: look for weight tensors named {model}_conv{i}_weight and {model}_fc{i}_weight
        // in order of i to reconstruct the forward pass.

        let input = match store.get(&args.input) {
            Some(t) => t.clone(),
            None => return Ok(CallToolResult::error(vec![Content::text(format!("Tensor '{}' not found", args.input))])),
        };

        // We need the original layer specs from init_cnn, but we didn't store them.
        // Instead, detect layers by scanning for weight tensors.
        // Walk param_idx 0,1,2,... collecting layers until none found.
        let mut conv_layers: Vec<(usize, Tensor, Tensor)> = Vec::new(); // (idx, weight, bias)
        let mut fc_layers: Vec<(usize, Tensor, Tensor)>   = Vec::new();

        for idx in 0..20 {
            let conv_w_name = format!("{}_conv{}_weight", args.model, idx);
            let fc_w_name   = format!("{}_fc{}_weight",   args.model, idx);
            if let (Some(w), Some(b)) = (store.get(&conv_w_name), store.get(&format!("{}_conv{}_bias", args.model, idx))) {
                conv_layers.push((idx, w.clone(), b.clone()));
            }
            if let (Some(w), Some(b)) = (store.get(&fc_w_name), store.get(&format!("{}_fc{}_bias", args.model, idx))) {
                fc_layers.push((idx, w.clone(), b.clone()));
            }
        }
        drop(store);

        let mut current = input.clone();
        let mut feature_maps: Vec<serde_json::Value> = Vec::new();

        // Apply conv layers → relu
        for (idx, w, b) in &conv_layers {
            let stride  = 1usize;
            let padding = 0usize;
            current = match conv2d(&current, w, Some(b), stride, padding) {
                Ok(t) => t,
                Err(e) => return Ok(CallToolResult::error(vec![Content::text(format!("conv layer {}: {}", idx, e))])),
            };
            current = relu(&current);
            feature_maps.push(json!({
                "layer": format!("conv{}_relu", idx),
                "shape": current.shape,
                "sample_values": &current.data[..current.data.len().min(8)],
            }));

            // Apply 2×2 max pool after each conv (if spatial dims allow)
            if current.shape.len() == 4 && current.shape[2] >= 2 && current.shape[3] >= 2 {
                current = match max_pool2d(&current, 2, 2) {
                    Ok(r) => r.output,
                    Err(e) => return Ok(CallToolResult::error(vec![Content::text(format!("pool after conv {}: {}", idx, e))])),
                };
                feature_maps.push(json!({
                    "layer": format!("max_pool_{}", idx),
                    "shape": current.shape,
                    "sample_values": &current.data[..current.data.len().min(8)],
                }));
            }
        }

        // Flatten [N, C, H, W] → [N, C*H*W]
        if current.shape.len() == 4 {
            let n = current.shape[0];
            let rest: usize = current.shape[1..].iter().product();
            current = match current.reshape(vec![n, rest]) {
                Some(t) => t,
                None => return Ok(CallToolResult::error(vec![Content::text("cnn_forward: flatten reshape failed".to_string())])),
            };
            feature_maps.push(json!({"layer": "flatten", "shape": current.shape}));
        }

        // Apply fc layers with tanh
        for (idx, w, b) in &fc_layers {
            let rows  = current.shape[0];
            let in_f  = w.shape[0];
            let out_f = w.shape[1];
            if current.shape[1] != in_f {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "fc layer {}: input features {} != weight in_features {}", idx, current.shape[1], in_f
                ))]));
            }
            let mut result = vec![0.0f32; rows * out_f];
            for i in 0..rows {
                for j in 0..out_f {
                    let mut sum = b.data[j];
                    for k in 0..in_f {
                        sum += current.data[i * in_f + k] * w.data[k * out_f + j];
                    }
                    result[i * out_f + j] = sum.tanh();
                }
            }
            current = Tensor::new(result, vec![rows, out_f]);
            feature_maps.push(json!({"layer": format!("fc{}_tanh", idx), "shape": current.shape, "output": current.data}));
        }

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&json!({
                "op": "cnn_forward",
                "model": args.model,
                "input_shape": input.shape,
                "output_shape": current.shape,
                "output": current.data,
                "feature_maps": feature_maps,
            })).unwrap()
        )]))
    }
}
