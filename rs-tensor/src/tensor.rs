//! # Tensor module
//!
//! A simple tensor type for learning Rust: a multi-dimensional array of `f32`s
//! with a flat `data` buffer, a `shape`, and `strides` for interpreting layout.
//!
//! For a walkthrough of the concepts (ownership, iterators, strides, etc.),
//! see the learning book in `docs/` (start with `docs/README.md`).

#[derive(Debug, Clone)]
pub struct Tensor {
    /// Flattened element storage (row-major). All elements in one `Vec`.
    pub data: Vec<f32>,
    /// Dimensions, e.g. `[3]` for length 3, `[2, 3]` for a 2×3 tensor.
    pub shape: Vec<usize>,
    /// How far to jump in `data` per step in each dimension.
    /// For a row-major [2, 3] tensor, strides are [3, 1]:
    /// advance 1 in dim 0 (row) → skip 3 elements,
    /// advance 1 in dim 1 (col) → skip 1 element.
    pub strides: Vec<usize>,
    /// Optional gradient storage, filled during backward pass.
    /// Used by training tools (sgd_step) to update weights.
    pub grad: Option<Vec<f32>>,
}

impl Tensor {
    /// Compute row-major strides from a shape.
    ///
    /// Starts from the right with stride 1, then each stride to the left
    /// is the product of all sizes to its right.
    /// e.g. shape [2, 3, 4] → strides [12, 4, 1].
    pub fn compute_strides(shape: &[usize]) -> Vec<usize> {
        let mut strides = vec![1; shape.len()];
        for i in (0..shape.len().saturating_sub(1)).rev() {
            strides[i] = strides[i + 1] * shape[i + 1];
        }
        strides
    }

    /// Build a tensor from a flat data buffer and shape.
    /// Strides are computed automatically (row-major).
    pub fn new(data: Vec<f32>, shape: Vec<usize>) -> Self {
        let strides = Self::compute_strides(&shape);
        Self {
            data,
            shape,
            strides,
            grad: None,
        }
    }

    /// Get a single element from a 2D tensor by (row, col).
    ///
    /// Returns `None` if the indices are out of bounds or the tensor
    /// isn't 2D. Uses strides: `index = row * strides[0] + col * strides[1]`.
    pub fn get_2d(&self, row: usize, col: usize) -> Option<f32> {
        if self.shape.len() != 2 {
            return None;
        }
        if row >= self.shape[0] || col >= self.shape[1] {
            return None;
        }
        let index = row * self.strides[0] + col * self.strides[1];
        Some(self.data[index])
    }

    /// Get a single element by N-dimensional indices.
    ///
    /// The number of indices must match the number of dimensions.
    /// Each index must be within bounds for its dimension.
    /// Computes the flat index as: `sum(indices[i] * strides[i])`.
    pub fn get(&self, indices: &[usize]) -> Option<f32> {
        if indices.len() != self.shape.len() {
            return None;
        }
        for (idx, dim) in indices.iter().zip(self.shape.iter()) {
            if idx >= dim {
                return None;
            }
        }
        let flat: usize = indices
            .iter()
            .zip(self.strides.iter())
            .map(|(i, s)| i * s)
            .sum();
        Some(self.data[flat])
    }

    /// Reshape: return a new tensor with a different shape but the same data.
    ///
    /// The product of the new shape must equal the number of elements.
    /// If this tensor has non-contiguous strides (e.g. after transpose),
    /// the data is first copied into contiguous order.
    pub fn reshape(&self, new_shape: Vec<usize>) -> Option<Tensor> {
        let new_size: usize = new_shape.iter().product();
        if new_size != self.data.len() {
            return None;
        }
        // If strides are non-contiguous, collect data in logical order first
        let data = if self.is_contiguous() {
            self.data.clone()
        } else {
            self.to_contiguous_data()
        };
        Some(Tensor::new(data, new_shape))
    }

    /// Transpose: swap two dimensions. Doesn't copy data — just swaps
    /// the shape and strides entries.
    ///
    /// For a 2D tensor this is the classic matrix transpose.
    /// For N-D, you pick which two axes to swap.
    pub fn transpose(&self, dim0: usize, dim1: usize) -> Option<Tensor> {
        if dim0 >= self.shape.len() || dim1 >= self.shape.len() {
            return None;
        }
        let mut new_shape = self.shape.clone();
        let mut new_strides = self.strides.clone();
        new_shape.swap(dim0, dim1);
        new_strides.swap(dim0, dim1);
        Some(Tensor {
            data: self.data.clone(),
            shape: new_shape,
            strides: new_strides,
            grad: None,
        })
    }

    /// Check if the tensor's strides match contiguous row-major layout.
    pub fn is_contiguous(&self) -> bool {
        self.strides == Self::compute_strides(&self.shape)
    }

    /// Collect elements in logical (shape) order into a new Vec.
    /// Used when a non-contiguous tensor needs to be materialized
    /// (e.g. before reshape).
    fn to_contiguous_data(&self) -> Vec<f32> {
        let n: usize = self.shape.iter().product();
        let ndim = self.shape.len();
        let mut result = Vec::with_capacity(n);
        let mut indices = vec![0usize; ndim];

        for _ in 0..n {
            let flat: usize = indices
                .iter()
                .zip(self.strides.iter())
                .map(|(i, s)| i * s)
                .sum();
            result.push(self.data[flat]);

            // Increment indices (odometer-style, rightmost first)
            for d in (0..ndim).rev() {
                indices[d] += 1;
                if indices[d] < self.shape[d] {
                    break;
                }
                indices[d] = 0;
            }
        }
        result
    }

    /// Create a tensor filled with zeros.
    pub fn zeros(shape: Vec<usize>) -> Self {
        let size: usize = shape.iter().product();
        Tensor::new(vec![0.0; size], shape)
    }

    /// Create a tensor filled with ones.
    pub fn ones(shape: Vec<usize>) -> Self {
        let size: usize = shape.iter().product();
        Tensor::new(vec![1.0; size], shape)
    }

    /// Sum all elements into a scalar (1-element tensor with shape [1]).
    pub fn sum(&self) -> Tensor {
        let total: f32 = self.data.iter().sum();
        Tensor::new(vec![total], vec![1])
    }

    /// Scale every element by a scalar value.
    pub fn scale(&self, scalar: f32) -> Tensor {
        let data = self.data.iter().map(|x| x * scalar).collect();
        Tensor::new(data, self.shape.clone())
    }

    /// Matrix multiplication for 2D tensors: [M, K] x [K, N] → [M, N].
    ///
    /// Uses the naive triple-loop algorithm. Both tensors must be 2D
    /// and the inner dimensions must match.
    pub fn matmul(&self, other: &Tensor) -> Tensor {
        assert_eq!(self.shape.len(), 2, "matmul requires 2D tensors");
        assert_eq!(other.shape.len(), 2, "matmul requires 2D tensors");
        let (m, k1) = (self.shape[0], self.shape[1]);
        let (k2, n) = (other.shape[0], other.shape[1]);
        assert_eq!(k1, k2, "matmul inner dimensions must match: {} vs {}", k1, k2);

        // Ensure both tensors are contiguous for simple indexing
        let a_data = if self.is_contiguous() {
            &self.data
        } else {
            &self.to_contiguous_data()
        };
        let b_data = if other.is_contiguous() {
            &other.data
        } else {
            &other.to_contiguous_data()
        };

        let mut result = vec![0.0f32; m * n];
        for i in 0..m {
            for j in 0..n {
                let mut sum = 0.0f32;
                for p in 0..k1 {
                    sum += a_data[i * k1 + p] * b_data[p * n + j];
                }
                result[i * n + j] = sum;
            }
        }
        Tensor::new(result, vec![m, n])
    }

    /// Row-wise softmax for 2D tensors: `softmax(x)[i,j] = exp(x[i,j]) / sum_j(exp(x[i,j]))`.
    ///
    /// Uses the max-subtraction trick for numerical stability:
    /// subtract the row max before exponentiating to avoid overflow.
    pub fn softmax(&self) -> Tensor {
        assert_eq!(self.shape.len(), 2, "softmax requires 2D tensor");
        let rows = self.shape[0];
        let cols = self.shape[1];
        let mut result = vec![0.0f32; rows * cols];

        for i in 0..rows {
            let row_start = i * cols;
            // Max-subtraction trick
            let row_max = (0..cols)
                .map(|j| self.data[row_start + j])
                .fold(f32::NEG_INFINITY, f32::max);

            let mut sum_exp = 0.0f32;
            for j in 0..cols {
                let e = (self.data[row_start + j] - row_max).exp();
                result[row_start + j] = e;
                sum_exp += e;
            }
            for j in 0..cols {
                result[row_start + j] /= sum_exp;
            }
        }
        Tensor::new(result, self.shape.clone())
    }

    /// RMSNorm: normalize a 1D vector by its root-mean-square, then scale by weights.
    ///
    /// `out[i] = (x[i] / rms(x)) * weight[i]`
    /// where `rms(x) = sqrt(mean(x^2) + eps)`
    ///
    /// LLaMA uses this instead of LayerNorm — it's simpler (no mean subtraction).
    pub fn rms_norm(&self, weight: &Tensor, eps: f32) -> Tensor {
        assert_eq!(self.shape.len(), 1);
        assert_eq!(self.shape, weight.shape);
        let n = self.data.len() as f32;
        let ss: f32 = self.data.iter().map(|x| x * x).sum::<f32>() / n;
        let rms = (ss + eps).sqrt();
        let data = self
            .data
            .iter()
            .zip(weight.data.iter())
            .map(|(x, w)| (x / rms) * w)
            .collect();
        Tensor::new(data, self.shape.clone())
    }

    /// SiLU (Sigmoid Linear Unit): `silu(x) = x * sigmoid(x)`.
    /// Used in SwiGLU, the FFN activation in LLaMA.
    pub fn silu(&self) -> Tensor {
        let data = self
            .data
            .iter()
            .map(|x| x * (1.0 / (1.0 + (-x).exp())))
            .collect();
        Tensor::new(data, self.shape.clone())
    }

    /// Apply RoPE (Rotary Position Embedding) to a vector.
    ///
    /// Rotates pairs of elements by position-dependent angles.
    /// For position `pos` and pair index `i`:
    ///   freq = 1 / (10000 ^ (2i / dim))
    ///   angle = pos * freq
    ///   [x[2i], x[2i+1]] = [x[2i]*cos - x[2i+1]*sin, x[2i]*sin + x[2i+1]*cos]
    pub fn rope(&self, pos: usize, head_dim: usize) -> Tensor {
        assert_eq!(self.shape.len(), 1);
        let mut data = self.data.clone();
        for i in (0..head_dim).step_by(2) {
            let freq = 1.0 / (10000.0_f32).powf(i as f32 / head_dim as f32);
            let angle = pos as f32 * freq;
            let cos = angle.cos();
            let sin = angle.sin();
            let x0 = data[i];
            let x1 = data[i + 1];
            data[i] = x0 * cos - x1 * sin;
            data[i + 1] = x0 * sin + x1 * cos;
        }
        Tensor::new(data, self.shape.clone())
    }

    /// Get a row from a 2D tensor as a 1D tensor.
    pub fn row(&self, i: usize) -> Tensor {
        assert_eq!(self.shape.len(), 2);
        let cols = self.shape[1];
        let start = i * cols;
        Tensor::new(self.data[start..start + cols].to_vec(), vec![cols])
    }

    /// Matrix-vector multiply: [M, N] @ [N] -> [M].
    /// More efficient than reshaping to [1, N] and using matmul.
    pub fn matvec(&self, vec: &Tensor) -> Tensor {
        assert_eq!(self.shape.len(), 2);
        assert_eq!(vec.shape.len(), 1);
        let (m, n) = (self.shape[0], self.shape[1]);
        assert_eq!(n, vec.shape[0]);

        let mut result = vec![0.0f32; m];
        for i in 0..m {
            let mut sum = 0.0f32;
            for j in 0..n {
                sum += self.data[i * n + j] * vec.data[j];
            }
            result[i] = sum;
        }
        Tensor::new(result, vec![m])
    }

    /// Element-wise addition. Panics if shapes differ.
    pub fn add(&self, other: &Tensor) -> Tensor {
        assert_eq!(self.shape, other.shape, "shape mismatch for add");
        let data = self
            .data
            .iter()
            .zip(other.data.iter())
            .map(|(a, b)| a + b)
            .collect();
        Tensor::new(data, self.shape.clone())
    }

    /// Element-wise multiplication. Panics if shapes differ.
    pub fn mul(&self, other: &Tensor) -> Tensor {
        assert_eq!(self.shape, other.shape, "shape mismatch for mul");
        let data = self
            .data
            .iter()
            .zip(other.data.iter())
            .map(|(a, b)| a * b)
            .collect();
        Tensor::new(data, self.shape.clone())
    }
}
