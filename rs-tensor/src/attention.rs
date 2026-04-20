//! # Scaled Dot-Product Attention
//!
//! Implements the attention mechanism from "Attention Is All You Need":
//! `Attention(Q, K, V) = softmax(Q @ K^T / sqrt(d_k)) @ V`
//!
//! Built on `TensorValue` so gradients flow through the entire computation.

use crate::tensor_value::TensorValue;

/// Compute scaled dot-product attention.
///
/// - `q`: queries,  shape `[seq_len, d_k]`
/// - `k`: keys,     shape `[seq_len, d_k]`
/// - `v`: values,   shape `[seq_len, d_v]`
///
/// Returns `(output, attention_weights)`:
/// - `output`: shape `[seq_len, d_v]`
/// - `attention_weights`: shape `[seq_len, seq_len]` (the softmax scores)
pub fn scaled_dot_product_attention(
    q: &TensorValue,
    k: &TensorValue,
    v: &TensorValue,
) -> (TensorValue, TensorValue) {
    let d_k = q.data().shape[1] as f32;

    // Q @ K^T → [seq_len, seq_len]
    let kt = k.transpose(0, 1);
    let scores = q.matmul(&kt);

    // Scale by 1/sqrt(d_k)
    let scaled = scores.scale(1.0 / d_k.sqrt());

    // Softmax → attention weights
    let weights = scaled.softmax();

    // weights @ V → [seq_len, d_v]
    let output = weights.matmul(v);

    (output, weights)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tensor::Tensor;

    #[test]
    fn test_attention_shapes() {
        // seq_len=3, d_k=4, d_v=2
        let q = TensorValue::new(Tensor::new(vec![0.1; 12], vec![3, 4]), "q");
        let k = TensorValue::new(Tensor::new(vec![0.1; 12], vec![3, 4]), "k");
        let v = TensorValue::new(Tensor::new(vec![0.2; 6], vec![3, 2]), "v");

        let (output, weights) = scaled_dot_product_attention(&q, &k, &v);

        assert_eq!(output.data().shape, vec![3, 2]);
        assert_eq!(weights.data().shape, vec![3, 3]);
    }

    #[test]
    fn test_attention_weights_sum_to_one() {
        let q = TensorValue::new(
            Tensor::new(vec![1.0, 0.0, 0.0, 1.0, 1.0, 1.0], vec![3, 2]),
            "q",
        );
        let k = TensorValue::new(
            Tensor::new(vec![1.0, 0.0, 0.0, 1.0, 0.5, 0.5], vec![3, 2]),
            "k",
        );
        let v = TensorValue::new(
            Tensor::new(vec![1.0, 0.0, 0.0, 1.0, 0.5, 0.5], vec![3, 2]),
            "v",
        );

        let (_, weights) = scaled_dot_product_attention(&q, &k, &v);
        let w = weights.data();

        // Each row of attention weights should sum to ~1.0
        for i in 0..3 {
            let row_sum: f32 = (0..3).map(|j| w.data[i * 3 + j]).sum();
            assert!(
                (row_sum - 1.0).abs() < 1e-5,
                "row {} sums to {}, expected 1.0",
                i,
                row_sum
            );
        }
    }

    #[test]
    fn test_attention_backward() {
        // Use V with different row magnitudes so softmax gradients are non-zero.
        // When V rows are identical or sum(output) is used with uniform V,
        // the weights.grad is uniform per row → softmax grad is zero (correct but uninteresting).
        let q = TensorValue::new(
            Tensor::new(vec![1.0, 2.0, 3.0, 4.0], vec![2, 2]),
            "q",
        );
        let k = TensorValue::new(
            Tensor::new(vec![0.5, 1.0, 1.5, 0.5], vec![2, 2]),
            "k",
        );
        let v = TensorValue::new(
            Tensor::new(vec![10.0, 0.0, 0.0, 1.0], vec![2, 2]),
            "v",
        );

        let (output, _) = scaled_dot_product_attention(&q, &k, &v);

        // Use element-wise mul with a non-uniform target to break symmetry
        let target = TensorValue::new(
            Tensor::new(vec![1.0, 0.0, 0.0, 1.0], vec![2, 2]),
            "target",
        );
        let loss = output.mul(&target).sum();
        loss.backward();

        // v always gets gradients from the matmul
        assert!(
            v.grad().data.iter().any(|g| g.abs() > 1e-10),
            "v has all-zero grad"
        );
        // q and k get gradients through the softmax → they should be non-zero
        // because the per-row gradient into weights is now non-uniform
        assert!(
            q.grad().data.iter().any(|g| g.abs() > 1e-10),
            "q has all-zero grad"
        );
        assert!(
            k.grad().data.iter().any(|g| g.abs() > 1e-10),
            "k has all-zero grad"
        );
    }

    #[test]
    fn test_identical_queries_uniform_attention() {
        // If all queries are identical, attention weights should be uniform
        let q = TensorValue::new(
            Tensor::new(vec![1.0, 1.0, 1.0, 1.0], vec![2, 2]),
            "q",
        );
        let k = TensorValue::new(
            Tensor::new(vec![1.0, 0.0, 0.0, 1.0], vec![2, 2]),
            "k",
        );
        let v = TensorValue::new(
            Tensor::new(vec![10.0, 0.0, 0.0, 10.0], vec![2, 2]),
            "v",
        );

        let (output, weights) = scaled_dot_product_attention(&q, &k, &v);
        let w = weights.data();

        // Both queries are [1,1], both keys dot to 1.0 with [1,1]
        // So scores are equal → uniform weights → each row ~[0.5, 0.5]
        for i in 0..2 {
            for j in 0..2 {
                assert!(
                    (w.data[i * 2 + j] - 0.5).abs() < 1e-5,
                    "weight[{},{}] = {}, expected 0.5",
                    i, j, w.data[i * 2 + j]
                );
            }
        }

        // Output should be average of V rows: [5.0, 5.0] for each row
        for i in 0..2 {
            for j in 0..2 {
                assert!(
                    (output.data().data[i * 2 + j] - 5.0).abs() < 1e-4,
                    "output[{},{}] = {}, expected 5.0",
                    i, j, output.data().data[i * 2 + j]
                );
            }
        }
    }
}
