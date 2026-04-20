use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::Parameters,
    model::*,
    prompt, prompt_router, schemars,
};

use super::TensorServer;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ExplainTensorOpArgs {
    /// The operation to explain (e.g. "add", "matmul", "reshape", "transpose")
    pub operation: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DebugShapeMismatchArgs {
    /// Shape of the first tensor, e.g. "2,3"
    pub shape_a: String,
    /// Shape of the second tensor, e.g. "3,4"
    pub shape_b: String,
    /// The operation that failed (e.g. "add", "matmul")
    pub operation: String,
}

#[prompt_router(vis = "pub(crate)")]
impl TensorServer {
    #[prompt(
        name = "explain_tensor_op",
        description = "Explain how a tensor operation works, step by step with a numeric example"
    )]
    async fn explain_tensor_op(
        &self,
        Parameters(args): Parameters<ExplainTensorOpArgs>,
    ) -> Result<GetPromptResult, McpError> {
        Ok(GetPromptResult {
            description: Some(format!("Explanation of tensor {} operation", args.operation)),
            messages: vec![PromptMessage::new_text(
                PromptMessageRole::User,
                format!(
                    "Explain how the tensor '{}' operation works. \
                     Cover: what shapes are valid, what the output shape is, \
                     and walk through a small numeric example with a 2x3 matrix.",
                    args.operation
                ),
            )],
        })
    }

    #[prompt(
        name = "debug_shape_mismatch",
        description = "Help debug a shape mismatch error between two tensors"
    )]
    async fn debug_shape_mismatch(
        &self,
        Parameters(args): Parameters<DebugShapeMismatchArgs>,
    ) -> Result<GetPromptResult, McpError> {
        Ok(GetPromptResult {
            description: Some("Debug a tensor shape mismatch".to_string()),
            messages: vec![PromptMessage::new_text(
                PromptMessageRole::User,
                format!(
                    "I got a shape mismatch error when trying to {} two tensors. \
                     Tensor A has shape [{}] and tensor B has shape [{}]. \
                     Why doesn't this work? What shapes would be valid? \
                     How could I reshape to make this operation work?",
                    args.operation, args.shape_a, args.shape_b
                ),
            )],
        })
    }

    #[prompt(
        name = "learning_guide",
        description = "Get a learning guide based on the project roadmap and current progress"
    )]
    async fn learning_guide(&self) -> Result<GetPromptResult, McpError> {
        let roadmap = tokio::fs::read_to_string("docs/ml-rust-project.md")
            .await
            .unwrap_or_else(|_| "Roadmap file not found.".to_string());

        Ok(GetPromptResult {
            description: Some("Current learning status and next steps".to_string()),
            messages: vec![PromptMessage::new_text(
                PromptMessageRole::User,
                format!(
                    "Here is my current learning roadmap:\n\n{}\n\n\
                     Based on this, what should I focus on next? \
                     What concepts should I understand before moving forward?",
                    roadmap
                ),
            )],
        })
    }
}
