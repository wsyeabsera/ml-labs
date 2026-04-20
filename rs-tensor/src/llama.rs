//! # LLaMA inference
//!
//! Loads a LLaMA model from GGUF and runs inference (next-token prediction).
//! This is the "wire everything together" module — tensors, matmul, attention,
//! RMSNorm, RoPE, and SwiGLU all come together here.

use std::io::{Read, Seek};

use crate::gguf::GgufFile;
use crate::tensor::Tensor;

/// Model hyperparameters extracted from GGUF metadata.
pub struct LlamaConfig {
    pub dim: usize,           // embedding dimension (288)
    pub n_layers: usize,      // number of transformer blocks (6)
    pub n_heads: usize,       // number of attention heads (6)
    pub n_kv_heads: usize,    // number of KV heads (may differ for GQA)
    pub vocab_size: usize,    // vocabulary size (32000)
    pub ffn_dim: usize,       // feedforward hidden dimension (768)
    pub head_dim: usize,      // dim / n_heads
    pub rms_eps: f32,         // RMSNorm epsilon (1e-5)
}

/// All the weight tensors for a single transformer block.
pub struct TransformerBlock {
    pub attn_q: Tensor,       // [dim, dim]
    pub attn_k: Tensor,       // [dim, dim]
    pub attn_v: Tensor,       // [dim, dim]
    pub attn_output: Tensor,  // [dim, dim]
    pub attn_norm: Tensor,    // [dim]
    pub ffn_gate: Tensor,     // [dim, ffn_dim]
    pub ffn_down: Tensor,     // [ffn_dim, dim]
    pub ffn_up: Tensor,       // [dim, ffn_dim]
    pub ffn_norm: Tensor,     // [dim]
}

/// A loaded LLaMA model ready for inference.
pub struct LlamaModel {
    pub config: LlamaConfig,
    pub token_embd: Tensor,    // [dim, vocab_size] — embedding table
    pub output: Tensor,        // [dim, vocab_size] — final projection
    pub output_norm: Tensor,   // [dim]
    pub blocks: Vec<TransformerBlock>,
}

impl LlamaModel {
    /// Load a LLaMA model from a parsed GGUF file.
    pub fn from_gguf<R: Read + Seek>(gguf: &mut GgufFile<R>) -> std::io::Result<Self> {
        let meta = &gguf.metadata;

        let dim = meta.get("llama.embedding_length")
            .and_then(|v| v.as_u32())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing llama.embedding_length"))? as usize;

        let n_layers = meta.get("llama.block_count")
            .and_then(|v| v.as_u32())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing llama.block_count"))? as usize;

        let n_heads = meta.get("llama.attention.head_count")
            .and_then(|v| v.as_u32())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing llama.attention.head_count"))? as usize;

        let n_kv_heads = meta.get("llama.attention.head_count_kv")
            .and_then(|v| v.as_u32())
            .unwrap_or(n_heads as u32) as usize;

        let ffn_dim = meta.get("llama.feed_forward_length")
            .and_then(|v| v.as_u32())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing llama.feed_forward_length"))? as usize;

        let rms_eps = meta.get("llama.attention.layer_norm_rms_epsilon")
            .and_then(|v| v.as_f32())
            .unwrap_or(1e-5);

        // Load embedding first to infer vocab_size from the loaded (reversed) shape
        let token_embd = gguf.load_tensor("token_embd.weight")?;
        // After GGUF shape reversal: [vocab_size, dim]
        let vocab_size_from_shape = token_embd.shape[0];

        let config = LlamaConfig {
            dim,
            n_layers,
            n_heads,
            n_kv_heads,
            vocab_size: vocab_size_from_shape,
            ffn_dim,
            head_dim: dim / n_heads,
            rms_eps,
        };

        // Load remaining global tensors (token_embd already loaded above)
        let output_norm = gguf.load_tensor("output_norm.weight")?;
        let output = gguf.load_tensor("output.weight")?;

        // Load per-block tensors
        let mut blocks = Vec::with_capacity(n_layers);
        for i in 0..n_layers {
            let block = TransformerBlock {
                attn_q: gguf.load_tensor(&format!("blk.{}.attn_q.weight", i))?,
                attn_k: gguf.load_tensor(&format!("blk.{}.attn_k.weight", i))?,
                attn_v: gguf.load_tensor(&format!("blk.{}.attn_v.weight", i))?,
                attn_output: gguf.load_tensor(&format!("blk.{}.attn_output.weight", i))?,
                attn_norm: gguf.load_tensor(&format!("blk.{}.attn_norm.weight", i))?,
                ffn_gate: gguf.load_tensor(&format!("blk.{}.ffn_gate.weight", i))?,
                ffn_down: gguf.load_tensor(&format!("blk.{}.ffn_down.weight", i))?,
                ffn_up: gguf.load_tensor(&format!("blk.{}.ffn_up.weight", i))?,
                ffn_norm: gguf.load_tensor(&format!("blk.{}.ffn_norm.weight", i))?,
            };
            blocks.push(block);
        }

        Ok(LlamaModel {
            config,
            token_embd,
            output,
            output_norm,
            blocks,
        })
    }

    /// Run one forward pass for a single token at a given position.
    ///
    /// Returns logits over the vocabulary (unnormalized scores for next token).
    /// Uses KV-cache vectors passed in (updated in place).
    pub fn forward(
        &self,
        token: usize,
        pos: usize,
        key_cache: &mut Vec<Vec<Tensor>>,   // [layer][pos] = [dim]
        value_cache: &mut Vec<Vec<Tensor>>,  // [layer][pos] = [dim]
    ) -> Tensor {
        let cfg = &self.config;

        // Token embedding: look up the row for this token
        let mut x = self.token_embd.row(token);

        for (layer, block) in self.blocks.iter().enumerate() {
            // RMSNorm before attention
            let x_norm = x.rms_norm(&block.attn_norm, cfg.rms_eps);

            // Q, K, V projections
            let q = block.attn_q.matvec(&x_norm);
            let k = block.attn_k.matvec(&x_norm);
            let v = block.attn_v.matvec(&x_norm);

            // Apply RoPE to Q and K (per head)
            let q = apply_rope_to_heads(&q, pos, cfg.n_heads, cfg.head_dim);
            let k = apply_rope_to_heads(&k, pos, cfg.n_kv_heads, cfg.head_dim);

            // Store K, V in cache
            key_cache[layer].push(k);
            value_cache[layer].push(v);

            // Multi-head attention over all cached positions
            let attn_out = multi_head_attention(
                &q,
                &key_cache[layer],
                &value_cache[layer],
                cfg.n_heads,
                cfg.n_kv_heads,
                cfg.head_dim,
            );

            // Output projection + residual
            let attn_proj = block.attn_output.matvec(&attn_out);
            x = x.add(&attn_proj);

            // RMSNorm before FFN
            let x_norm2 = x.rms_norm(&block.ffn_norm, cfg.rms_eps);

            // SwiGLU FFN: down(silu(gate(x)) * up(x))
            let gate = block.ffn_gate.matvec(&x_norm2).silu();
            let up = block.ffn_up.matvec(&x_norm2);
            let ffn_hidden = gate.mul(&up);
            let ffn_out = block.ffn_down.matvec(&ffn_hidden);

            // Residual
            x = x.add(&ffn_out);
        }

        // Final RMSNorm + output projection to logits
        let x_norm = x.rms_norm(&self.output_norm, cfg.rms_eps);
        self.output.matvec(&x_norm)
    }

    /// Generate tokens autoregressively.
    ///
    /// Takes a list of prompt token IDs, generates `max_tokens` more.
    /// Uses greedy decoding (argmax) or temperature sampling.
    pub fn generate(
        &self,
        prompt_tokens: &[usize],
        max_tokens: usize,
        temperature: f32,
    ) -> Vec<usize> {
        let n_layers = self.config.n_layers;
        let mut key_cache: Vec<Vec<Tensor>> = (0..n_layers).map(|_| Vec::new()).collect();
        let mut value_cache: Vec<Vec<Tensor>> = (0..n_layers).map(|_| Vec::new()).collect();

        let mut tokens = prompt_tokens.to_vec();
        let mut output_tokens = Vec::new();

        // Process prompt tokens (no output needed, just fill cache)
        for (pos, &token) in prompt_tokens.iter().enumerate() {
            let logits = self.forward(token, pos, &mut key_cache, &mut value_cache);
            // Only use the logits from the last prompt token
            if pos == prompt_tokens.len() - 1 {
                let next = sample_token(&logits, temperature);
                output_tokens.push(next);
                tokens.push(next);
            }
        }

        // Generate remaining tokens
        for i in 0..max_tokens.saturating_sub(1) {
            let pos = prompt_tokens.len() + i;
            let last_token = *tokens.last().unwrap();
            let logits = self.forward(last_token, pos, &mut key_cache, &mut value_cache);
            let next = sample_token(&logits, temperature);
            output_tokens.push(next);
            tokens.push(next);
        }

        output_tokens
    }
}

/// Apply RoPE rotation to each head in a concatenated Q or K vector.
fn apply_rope_to_heads(qk: &Tensor, pos: usize, n_heads: usize, head_dim: usize) -> Tensor {
    let mut data = qk.data.clone();
    for h in 0..n_heads {
        let offset = h * head_dim;
        for i in (0..head_dim).step_by(2) {
            let freq = 1.0 / (10000.0_f32).powf(i as f32 / head_dim as f32);
            let angle = pos as f32 * freq;
            let cos = angle.cos();
            let sin = angle.sin();
            let x0 = data[offset + i];
            let x1 = data[offset + i + 1];
            data[offset + i] = x0 * cos - x1 * sin;
            data[offset + i + 1] = x0 * sin + x1 * cos;
        }
    }
    Tensor::new(data, qk.shape.clone())
}

/// Multi-head attention with KV cache.
///
/// q: [dim] (current position only)
/// key_cache: list of [dim] vectors for all positions so far
/// value_cache: list of [dim] vectors for all positions so far
fn multi_head_attention(
    q: &Tensor,
    key_cache: &[Tensor],
    value_cache: &[Tensor],
    n_heads: usize,
    n_kv_heads: usize,
    head_dim: usize,
) -> Tensor {
    let seq_len = key_cache.len();
    let kv_group_size = n_heads / n_kv_heads; // for GQA: how many Q heads share a KV head
    let scale = 1.0 / (head_dim as f32).sqrt();

    let mut output = vec![0.0f32; n_heads * head_dim];

    for h in 0..n_heads {
        let q_offset = h * head_dim;
        let kv_head = h / kv_group_size;
        let kv_offset = kv_head * head_dim;

        // Compute attention scores for this head
        let mut scores = vec![0.0f32; seq_len];
        for t in 0..seq_len {
            let mut dot = 0.0f32;
            for d in 0..head_dim {
                dot += q.data[q_offset + d] * key_cache[t].data[kv_offset + d];
            }
            scores[t] = dot * scale;
        }

        // Softmax over scores
        let max_score = scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let mut sum_exp = 0.0f32;
        for s in &mut scores {
            *s = (*s - max_score).exp();
            sum_exp += *s;
        }
        for s in &mut scores {
            *s /= sum_exp;
        }

        // Weighted sum of values
        for t in 0..seq_len {
            let w = scores[t];
            for d in 0..head_dim {
                output[q_offset + d] += w * value_cache[t].data[kv_offset + d];
            }
        }
    }

    Tensor::new(output, vec![n_heads * head_dim])
}

/// Sample the next token from logits.
/// temperature=0 → greedy (argmax), temperature>0 → softmax sampling.
fn sample_token(logits: &Tensor, temperature: f32) -> usize {
    if temperature <= 0.0 {
        // Greedy: return argmax
        logits
            .data
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
            .map(|(i, _)| i)
            .unwrap()
    } else {
        // Temperature-scaled softmax sampling
        let max_logit = logits.data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let mut probs: Vec<f32> = logits
            .data
            .iter()
            .map(|x| ((x - max_logit) / temperature).exp())
            .collect();
        let sum: f32 = probs.iter().sum();
        for p in &mut probs {
            *p /= sum;
        }

        // Simple random sampling using a basic LCG (no external deps)
        // Seed from position in the probability distribution
        let mut rng_state: u64 = logits.data.len() as u64;
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let random: f32 = (rng_state >> 33) as f32 / (1u64 << 31) as f32;

        let mut cumulative = 0.0f32;
        for (i, p) in probs.iter().enumerate() {
            cumulative += p;
            if cumulative > random {
                return i;
            }
        }
        probs.len() - 1
    }
}

/// Extract the token vocabulary from GGUF metadata.
/// Returns a list of token strings indexed by token ID.
pub fn extract_vocab<R: Read + Seek>(gguf: &GgufFile<R>) -> Vec<String> {
    use crate::gguf::MetadataValue;

    match gguf.metadata.get("tokenizer.ggml.tokens") {
        Some(MetadataValue::Array(tokens)) => tokens
            .iter()
            .map(|v| match v {
                MetadataValue::String(s) => s.clone(),
                _ => "?".to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Decode token IDs to text using the vocabulary.
/// Handles SentencePiece encoding where '▁' (U+2581) represents a space.
pub fn decode_tokens(vocab: &[String], tokens: &[usize]) -> String {
    let mut text = String::new();
    for &id in tokens {
        if id < vocab.len() {
            let token = &vocab[id];
            // SentencePiece uses ▁ for space
            text.push_str(&token.replace('▁', " "));
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_rope() {
        // 2 heads, head_dim=2, position 0 → no rotation (angle=0, cos=1, sin=0)
        let q = Tensor::new(vec![1.0, 2.0, 3.0, 4.0], vec![4]);
        let rotated = apply_rope_to_heads(&q, 0, 2, 2);
        assert!((rotated.data[0] - 1.0).abs() < 1e-5);
        assert!((rotated.data[1] - 2.0).abs() < 1e-5);

        // Position 1 should rotate
        let rotated1 = apply_rope_to_heads(&q, 1, 2, 2);
        // First pair: freq = 1/10000^0 = 1, angle = 1
        let cos1 = 1.0_f32.cos();
        let sin1 = 1.0_f32.sin();
        assert!((rotated1.data[0] - (1.0 * cos1 - 2.0 * sin1)).abs() < 1e-5);
        assert!((rotated1.data[1] - (1.0 * sin1 + 2.0 * cos1)).abs() < 1e-5);
    }

    #[test]
    fn test_rms_norm() {
        let x = Tensor::new(vec![1.0, 2.0, 3.0], vec![3]);
        let w = Tensor::new(vec![1.0, 1.0, 1.0], vec![3]);
        let normed = x.rms_norm(&w, 1e-5);

        // rms = sqrt((1+4+9)/3) = sqrt(14/3) ≈ 2.16
        let rms = ((14.0f32 / 3.0) + 1e-5).sqrt();
        assert!((normed.data[0] - 1.0 / rms).abs() < 1e-5);
        assert!((normed.data[1] - 2.0 / rms).abs() < 1e-5);
    }

    #[test]
    fn test_silu() {
        let x = Tensor::new(vec![0.0, 1.0, -1.0], vec![3]);
        let y = x.silu();
        // silu(0) = 0 * sigmoid(0) = 0 * 0.5 = 0
        assert!((y.data[0]).abs() < 1e-5);
        // silu(1) = 1 * sigmoid(1) ≈ 0.7311
        assert!((y.data[1] - 0.7311).abs() < 1e-3);
    }

    #[test]
    fn test_matvec() {
        let m = Tensor::new(vec![1.0, 2.0, 3.0, 4.0], vec![2, 2]);
        let v = Tensor::new(vec![1.0, 1.0], vec![2]);
        let result = m.matvec(&v);
        assert_eq!(result.shape, vec![2]);
        assert_eq!(result.data, vec![3.0, 7.0]);
    }
}
