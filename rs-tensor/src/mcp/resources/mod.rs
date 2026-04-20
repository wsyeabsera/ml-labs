use std::path::Path;

use rmcp::{ErrorData as McpError, model::*};
use serde_json::json;

use super::TensorServer;

/// Project root at compile time (the directory containing Cargo.toml).
const PROJECT_ROOT: &str = env!("CARGO_MANIFEST_DIR");

fn doc_resource(uri: &str, name: &str, description: &str) -> Resource {
    RawResource {
        uri: uri.into(),
        name: name.into(),
        title: None,
        description: Some(description.into()),
        mime_type: Some("text/markdown".into()),
        size: None,
        icons: None,
        meta: None,
    }
    .no_annotation()
}

/// List static doc resources + dynamic tensor resources from the store.
pub async fn list_resources(server: &TensorServer) -> Result<ListResourcesResult, McpError> {
    let mut resources = vec![
        doc_resource("docs://readme", "Learning Book TOC", "Table of contents for the rs-tensor learning book"),
        doc_resource("docs://getting-started", "01 - Getting Started", "Introduction to the rs-tensor learning project"),
        doc_resource("docs://big-picture", "02 - The Big Picture", "What a tensor is: data + shape"),
        doc_resource("docs://codebase-and-next-steps", "03 - Codebase and Next Steps", "Phase 1 checklist, file layout, what to build next"),
        doc_resource("docs://mcp-server", "04 - The MCP Server", "How the MCP server works and what tools are exposed"),
        RawResource {
            uri: "source://tensor.rs".into(),
            name: "Tensor Source Code".into(),
            title: None,
            description: Some("The core Tensor struct implementation".into()),
            mime_type: Some("text/x-rust".into()),
            size: None,
            icons: None,
            meta: None,
        }
        .no_annotation(),
    ];

    // Add dynamic tensor resources
    let store = server.tensors.lock().await;
    for (name, tensor) in store.iter() {
        resources.push(
            RawResource {
                uri: format!("tensor://{}", name),
                name: format!("Tensor: {}", name),
                title: None,
                description: Some(format!(
                    "shape={:?}, {} elements",
                    tensor.shape,
                    tensor.data.len()
                )),
                mime_type: Some("application/json".into()),
                size: None,
                icons: None,
                meta: None,
            }
            .no_annotation(),
        );
    }

    Ok(ListResourcesResult::with_all_items(resources))
}

/// Expose URI templates for tensor:// and docs:// schemes.
pub async fn list_resource_templates() -> Result<ListResourceTemplatesResult, McpError> {
    Ok(ListResourceTemplatesResult::with_all_items(vec![
        RawResourceTemplate {
            uri_template: "tensor://{name}".into(),
            name: "Tensor Data".into(),
            title: Some("Read tensor data as JSON".into()),
            description: Some("Returns shape and data for a named tensor".into()),
            mime_type: Some("application/json".into()),
            icons: None,
        }
        .no_annotation(),
        RawResourceTemplate {
            uri_template: "docs://{slug}".into(),
            name: "Learning Docs".into(),
            title: Some("Read a learning doc by slug".into()),
            description: Some("e.g. docs://getting-started, docs://mcp-server".into()),
            mime_type: Some("text/markdown".into()),
            icons: None,
        }
        .no_annotation(),
    ]))
}

/// Route a URI to the right content.
pub async fn read_resource(
    server: &TensorServer,
    uri: &str,
) -> Result<ReadResourceResult, McpError> {
    if let Some(name) = uri.strip_prefix("tensor://") {
        let store = server.tensors.lock().await;
        match store.get(name) {
            Some(t) => Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(
                    serde_json::to_string_pretty(&json!({
                        "name": name,
                        "shape": t.shape,
                        "data": t.data,
                    }))
                    .unwrap(),
                    uri,
                )],
            }),
            None => Err(McpError::invalid_params(
                format!("Tensor '{}' not found", name),
                None,
            )),
        }
    } else if let Some(slug) = uri.strip_prefix("docs://") {
        let filename = match slug {
            "readme" => "docs/README.md",
            "getting-started" => "docs/01-getting-started.md",
            "big-picture" => "docs/02-the-big-picture.md",
            "codebase-and-next-steps" => "docs/03-codebase-and-next-steps.md",
            "mcp-server" => "docs/04-mcp-server.md",
            "roadmap" => "docs/ml-rust-project.md",
            _ => {
                return Err(McpError::invalid_params(
                    format!("Unknown doc slug: '{}'", slug),
                    None,
                ))
            }
        };
        let path = Path::new(PROJECT_ROOT).join(filename);
        match tokio::fs::read_to_string(&path).await {
            Ok(contents) => Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(contents, uri)],
            }),
            Err(e) => Err(McpError::invalid_params(
                format!("Failed to read '{}': {}", path.display(), e),
                None,
            )),
        }
    } else if uri == "source://tensor.rs" {
        let path = Path::new(PROJECT_ROOT).join("src/tensor.rs");
        match tokio::fs::read_to_string(&path).await {
            Ok(contents) => Ok(ReadResourceResult {
                contents: vec![ResourceContents::text(contents, uri)],
            }),
            Err(_) => Err(McpError::invalid_params(
                format!("Failed to read tensor.rs: {}", path.display()),
                None,
            )),
        }
    } else {
        Err(McpError::invalid_params(
            format!("Unknown resource URI: '{}'", uri),
            None,
        ))
    }
}
