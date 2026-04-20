pub mod prompts;
pub mod resources;
pub mod tools;

use std::collections::HashMap;
use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler,
    handler::server::router::prompt::PromptRouter,
    handler::server::router::tool::ToolRouter,
    model::*,
    prompt_handler,
    service::RequestContext,
    tool_handler,
};
use tokio::sync::Mutex;

use crate::llama::LlamaModel;
use crate::tensor::Tensor;

#[derive(Clone)]
pub struct TensorServer {
    pub(crate) tensors: Arc<Mutex<HashMap<String, Tensor>>>,
    pub(crate) model: Arc<Mutex<Option<LlamaModel>>>,
    pub(crate) vocab: Arc<Mutex<Vec<String>>>,
    tool_router: ToolRouter<TensorServer>,
    prompt_router: PromptRouter<TensorServer>,
}

impl TensorServer {
    pub fn new() -> Self {
        Self {
            tensors: Arc::new(Mutex::new(HashMap::new())),
            model: Arc::new(Mutex::new(None)),
            vocab: Arc::new(Mutex::new(Vec::new())),
            tool_router: Self::tool_router(),
            prompt_router: Self::prompt_router(),
        }
    }
}

#[tool_handler]
#[prompt_handler]
impl ServerHandler for TensorServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::default(),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .enable_prompts()
                .enable_resources()
                .build(),
            server_info: Implementation {
                name: "rs-tensor-mcp".into(),
                title: None,
                version: env!("CARGO_PKG_VERSION").into(),
                description: None,
                icons: None,
                website_url: None,
            },
            instructions: Some(
                "MCP server for the rs-tensor library. \
                 Create, inspect, and operate on tensors. \
                 Read project files and run cargo commands. \
                 Browse learning docs and tensor data as resources."
                    .to_string(),
            ),
        }
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        resources::list_resources(self).await
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, McpError> {
        resources::list_resource_templates().await
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, McpError> {
        resources::read_resource(self, &request.uri).await
    }
}
