//! # Multi-Layer Perceptron (MLP)
//!
//! A feedforward neural network built on top of `TensorValue`.
//! Each layer computes `tanh(x @ w + b)`, and layers are stacked
//! so the output of one becomes the input to the next.

use crate::tensor::Tensor;
use crate::tensor_value::TensorValue;

/// A single fully-connected layer: `out = tanh(x @ w + b)`
///
/// - `w` has shape `[in_features, out_features]`
/// - `b` has shape `[1, out_features]`
pub struct Layer {
    pub w: TensorValue,
    pub b: TensorValue,
}

impl Layer {
    /// Create a layer with explicit weight and bias data.
    pub fn new(w_data: Vec<f32>, b_data: Vec<f32>, in_features: usize, out_features: usize, label: &str) -> Self {
        let w = TensorValue::new(
            Tensor::new(w_data, vec![in_features, out_features]),
            &format!("{}_w", label),
        );
        let b = TensorValue::new(
            Tensor::new(b_data, vec![1, out_features]),
            &format!("{}_b", label),
        );
        Layer { w, b }
    }

    /// Forward pass: `tanh(x @ w + b)`
    ///
    /// `x` has shape `[batch, in_features]`, output is `[batch, out_features]`.
    pub fn forward(&self, x: &TensorValue) -> TensorValue {
        let xw = x.matmul(&self.w);
        let pre = xw.add(&self.b);
        pre.tanh()
    }
}

/// A multi-layer perceptron: a stack of `Layer`s.
///
/// Input flows through each layer in sequence. The final layer's
/// output is the network output.
pub struct MLP {
    pub layers: Vec<Layer>,
}

impl MLP {
    /// Create an MLP from a list of layers.
    pub fn new(layers: Vec<Layer>) -> Self {
        MLP { layers }
    }

    /// Forward pass through all layers.
    ///
    /// Input `x` has shape `[batch, in_features_of_first_layer]`.
    /// Output has shape `[batch, out_features_of_last_layer]`.
    pub fn forward(&self, x: &TensorValue) -> TensorValue {
        let mut current = x.clone();
        for layer in &self.layers {
            current = layer.forward(&current);
        }
        current
    }

    /// Collect all weight and bias TensorValues (for inspecting gradients).
    pub fn parameters(&self) -> Vec<(&str, TensorValue)> {
        let mut params = Vec::new();
        for layer in &self.layers {
            params.push(("w", layer.w.clone()));
            params.push(("b", layer.b.clone()));
        }
        params
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_layer_forward() {
        // x: [1, 2], w: [2, 1], b: [1, 1]
        let layer = Layer::new(
            vec![0.5, -0.5],
            vec![0.1],
            2, 1,
            "L0",
        );

        let x = TensorValue::new(Tensor::new(vec![1.0, 2.0], vec![1, 2]), "x");
        let out = layer.forward(&x);

        // x @ w = [1*0.5 + 2*(-0.5)] = [-0.5], + 0.1 = [-0.4], tanh(-0.4)
        let expected = (-0.4_f32).tanh();
        assert!((out.data().data[0] - expected).abs() < 1e-6);
    }

    #[test]
    fn test_single_layer_backward() {
        let layer = Layer::new(
            vec![0.5, -0.5],
            vec![0.1],
            2, 1,
            "L0",
        );

        let x = TensorValue::new(Tensor::new(vec![1.0, 2.0], vec![1, 2]), "x");
        let out = layer.forward(&x);
        out.backward();

        // All gradients should be non-zero
        assert!(layer.w.grad().data.iter().all(|g| g.abs() > 0.0));
        assert!(layer.b.grad().data.iter().all(|g| g.abs() > 0.0));
    }

    #[test]
    fn test_mlp_two_layers() {
        // 2 -> 3 -> 1
        let l0 = Layer::new(
            vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6], // [2, 3]
            vec![0.0, 0.0, 0.0],                   // [1, 3]
            2, 3,
            "L0",
        );
        let l1 = Layer::new(
            vec![0.7, 0.8, 0.9], // [3, 1]
            vec![0.0],            // [1, 1]
            3, 1,
            "L1",
        );

        let mlp = MLP::new(vec![l0, l1]);
        let x = TensorValue::new(Tensor::new(vec![1.0, 2.0], vec![1, 2]), "x");
        let out = mlp.forward(&x);

        // Output should be a [1, 1] tensor
        assert_eq!(out.data().shape, vec![1, 1]);

        // Run backward — all params should get gradients
        out.backward();
        for (name, param) in mlp.parameters() {
            assert!(
                param.grad().data.iter().any(|g| g.abs() > 0.0),
                "param {} has all-zero grad",
                name,
            );
        }
    }

    #[test]
    fn test_mlp_three_layers() {
        // 2 -> 4 -> 4 -> 1
        let l0 = Layer::new(
            vec![0.1, -0.2, 0.3, -0.4, 0.5, -0.1, 0.2, -0.3], // [2, 4]
            vec![0.0; 4],
            2, 4, "L0",
        );
        let l1 = Layer::new(
            vec![0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.1, 0.1,
                 -0.1, 0.2, -0.2, 0.3, 0.1, -0.1, 0.2, -0.2], // [4, 4]
            vec![0.0; 4],
            4, 4, "L1",
        );
        let l2 = Layer::new(
            vec![0.5, -0.3, 0.2, -0.1], // [4, 1]
            vec![0.0; 1],
            4, 1, "L2",
        );

        let mlp = MLP::new(vec![l0, l1, l2]);
        let x = TensorValue::new(Tensor::new(vec![1.0, -1.0], vec![1, 2]), "x");
        let out = mlp.forward(&x);

        assert_eq!(out.data().shape, vec![1, 1]);
        // Output should be tanh of something, so between -1 and 1
        let val = out.data().data[0];
        assert!(val > -1.0 && val < 1.0, "output {} out of tanh range", val);

        out.backward();
        for (name, param) in mlp.parameters() {
            assert!(
                param.grad().data.iter().any(|g| g.abs() > 0.0),
                "param {} has all-zero grad in 3-layer MLP",
                name,
            );
        }
    }
}
