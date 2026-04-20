use rmcp::{ServiceExt, transport::stdio};
use rs_tensor::mcp::TensorServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    eprintln!("rs-tensor MCP server starting...");

    let service = TensorServer::new()
        .serve(stdio())
        .await
        .inspect_err(|e| eprintln!("serving error: {:?}", e))?;

    service.waiting().await?;
    Ok(())
}
