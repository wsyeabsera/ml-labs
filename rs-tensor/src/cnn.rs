//! # CNN module
//!
//! Core convolutional neural network operations, implemented from scratch
//! so you can see exactly what's happening inside each layer.
//!
//! All operations use NCHW layout: [batch, channels, height, width].
//!
//! Operations:
//! - `conv2d`         — 2D convolution with learnable kernels
//! - `max_pool2d`     — spatial downsampling via max
//! - `avg_pool2d`     — spatial downsampling via average
//! - `batch_norm2d`   — per-channel normalization
//! - `global_avg_pool2d` — collapse spatial dims to a single vector per channel
//!
//! Flatten ([N,C,H,W] → [N, C*H*W]) is just `tensor.reshape(...)` — no new math.

use crate::tensor::Tensor;

/// Result of a conv2d forward pass.
/// Carries the output and the indices needed to route gradients in the backward pass.
pub struct Conv2dResult {
    /// Output feature maps: shape [N, C_out, out_H, out_W]
    pub output: Tensor,
    /// Argmax indices used by max_pool2d backward. Not used here — stored for symmetry.
    pub _padding: usize,
    pub _stride: usize,
}

/// 2D convolution: slide kernels over every input feature map and sum.
///
/// # Layout
/// - `input`:  `[N, C_in, H, W]`
/// - `kernel`: `[C_out, C_in, kH, kW]`
/// - `bias`:   `[C_out]` (optional — one scalar per output channel)
///
/// # Output shape
/// `[N, C_out, out_H, out_W]`
/// where `out_H = (H + 2*padding - kH) / stride + 1`
///
/// # How it works
/// For each output position (n, c_out, oh, ow):
///   sum over c_in, kh, kw of input[n, c_in, oh*stride + kh - pad, ow*stride + kw - pad]
///                               * kernel[c_out, c_in, kh, kw]
/// then add bias[c_out].
///
/// Padding positions that fall outside the input boundary contribute 0.0 (zero-padding).
pub fn conv2d(input: &Tensor, kernel: &Tensor, bias: Option<&Tensor>, stride: usize, padding: usize) -> Result<Tensor, String> {
    if input.shape.len() != 4 {
        return Err(format!("conv2d: input must be 4D [N,C,H,W], got {:?}", input.shape));
    }
    if kernel.shape.len() != 4 {
        return Err(format!("conv2d: kernel must be 4D [C_out,C_in,kH,kW], got {:?}", kernel.shape));
    }

    let (n, c_in, h, w)         = (input.shape[0],  input.shape[1],  input.shape[2],  input.shape[3]);
    let (c_out, k_cin, kh, kw)  = (kernel.shape[0], kernel.shape[1], kernel.shape[2], kernel.shape[3]);

    if k_cin != c_in {
        return Err(format!("conv2d: kernel C_in={} but input C_in={}", k_cin, c_in));
    }
    if let Some(b) = bias {
        if b.shape != vec![c_out] {
            return Err(format!("conv2d: bias shape must be [{}], got {:?}", c_out, b.shape));
        }
    }
    if stride == 0 {
        return Err("conv2d: stride must be >= 1".to_string());
    }
    if kh > h + 2 * padding || kw > w + 2 * padding {
        return Err(format!("conv2d: kernel {}×{} larger than padded input {}×{}", kh, kw, h + 2*padding, w + 2*padding));
    }

    let out_h = (h + 2 * padding - kh) / stride + 1;
    let out_w = (w + 2 * padding - kw) / stride + 1;
    let total = n * c_out * out_h * out_w;
    let mut out_data = vec![0.0f32; total];

    // Strides for flat indexing into input [N, C_in, H, W]
    let in_stride_n  = c_in * h * w;
    let in_stride_c  = h * w;
    // Strides for flat indexing into kernel [C_out, C_in, kH, kW]
    let k_stride_co  = c_in * kh * kw;
    let k_stride_ci  = kh * kw;
    // Strides for flat indexing into output [N, C_out, out_H, out_W]
    let out_stride_n = c_out * out_h * out_w;
    let out_stride_c = out_h * out_w;

    for bn in 0..n {
        for co in 0..c_out {
            for oh in 0..out_h {
                for ow in 0..out_w {
                    let mut acc = bias.map(|b| b.data[co]).unwrap_or(0.0);

                    for ci in 0..c_in {
                        for khi in 0..kh {
                            for kwi in 0..kw {
                                // Input spatial position (with padding offset)
                                let ih = oh * stride + khi;
                                let iw = ow * stride + kwi;

                                // Check bounds after removing padding offset
                                if ih < padding || iw < padding {
                                    continue; // zero-padding
                                }
                                let ih_real = ih - padding;
                                let iw_real = iw - padding;
                                if ih_real >= h || iw_real >= w {
                                    continue; // zero-padding
                                }

                                let in_idx = bn * in_stride_n + ci * in_stride_c + ih_real * w + iw_real;
                                let k_idx  = co * k_stride_co + ci * k_stride_ci + khi * kw + kwi;
                                acc += input.data[in_idx] * kernel.data[k_idx];
                            }
                        }
                    }

                    let out_idx = bn * out_stride_n + co * out_stride_c + oh * out_w + ow;
                    out_data[out_idx] = acc;
                }
            }
        }
    }

    Ok(Tensor::new(out_data, vec![n, c_out, out_h, out_w]))
}

/// Result of max_pool2d: output values + the flat input index of each max (for backward).
pub struct MaxPool2dResult {
    /// Pooled output: shape [N, C, out_H, out_W]
    pub output: Tensor,
    /// Flat input index of the max element for each output position.
    /// Same length as output.data — used for gradient routing in backward.
    pub argmax: Vec<usize>,
}

/// 2D max pooling: take the maximum value in each kernel_size × kernel_size window.
///
/// # Layout: input `[N, C, H, W]`, output `[N, C, out_H, out_W]`
///
/// Why max pooling works: the strongest activation in a region survives.
/// Translation invariance: if a feature shifts by one pixel, the same max
/// may still win, so the output stays the same. This is why CNNs are
/// robust to small spatial shifts.
pub fn max_pool2d(input: &Tensor, kernel_size: usize, stride: usize) -> Result<MaxPool2dResult, String> {
    validate_4d(input, "max_pool2d")?;
    if kernel_size == 0 || stride == 0 {
        return Err("max_pool2d: kernel_size and stride must be >= 1".to_string());
    }

    let (n, c, h, w) = dims4(input);
    if kernel_size > h || kernel_size > w {
        return Err(format!("max_pool2d: kernel {}×{} larger than input {}×{}", kernel_size, kernel_size, h, w));
    }

    let out_h = (h - kernel_size) / stride + 1;
    let out_w = (w - kernel_size) / stride + 1;
    let total = n * c * out_h * out_w;
    let mut out_data = vec![0.0f32; total];
    let mut argmax   = vec![0usize; total];

    let in_stride_n = c * h * w;
    let in_stride_c = h * w;
    let out_stride_n = c * out_h * out_w;
    let out_stride_c = out_h * out_w;

    for bn in 0..n {
        for ch in 0..c {
            for oh in 0..out_h {
                for ow in 0..out_w {
                    let mut max_val = f32::NEG_INFINITY;
                    let mut max_idx = 0usize;

                    for kh in 0..kernel_size {
                        for kw in 0..kernel_size {
                            let ih = oh * stride + kh;
                            let iw = ow * stride + kw;
                            let in_idx = bn * in_stride_n + ch * in_stride_c + ih * w + iw;
                            if input.data[in_idx] > max_val {
                                max_val = input.data[in_idx];
                                max_idx = in_idx;
                            }
                        }
                    }

                    let out_idx = bn * out_stride_n + ch * out_stride_c + oh * out_w + ow;
                    out_data[out_idx] = max_val;
                    argmax[out_idx]   = max_idx;
                }
            }
        }
    }

    Ok(MaxPool2dResult {
        output: Tensor::new(out_data, vec![n, c, out_h, out_w]),
        argmax,
    })
}

/// 2D average pooling: take the mean value in each kernel_size × kernel_size window.
///
/// Softer than max pooling — all elements in the window contribute equally.
/// Often used in the final layer before the classifier (global_avg_pool2d).
pub fn avg_pool2d(input: &Tensor, kernel_size: usize, stride: usize) -> Result<Tensor, String> {
    validate_4d(input, "avg_pool2d")?;
    if kernel_size == 0 || stride == 0 {
        return Err("avg_pool2d: kernel_size and stride must be >= 1".to_string());
    }

    let (n, c, h, w) = dims4(input);
    if kernel_size > h || kernel_size > w {
        return Err(format!("avg_pool2d: kernel {}×{} larger than input {}×{}", kernel_size, kernel_size, h, w));
    }

    let out_h = (h - kernel_size) / stride + 1;
    let out_w = (w - kernel_size) / stride + 1;
    let window = (kernel_size * kernel_size) as f32;
    let mut out_data = vec![0.0f32; n * c * out_h * out_w];

    let in_stride_n  = c * h * w;
    let in_stride_c  = h * w;
    let out_stride_n = c * out_h * out_w;
    let out_stride_c = out_h * out_w;

    for bn in 0..n {
        for ch in 0..c {
            for oh in 0..out_h {
                for ow in 0..out_w {
                    let mut sum = 0.0f32;
                    for kh in 0..kernel_size {
                        for kw in 0..kernel_size {
                            let ih = oh * stride + kh;
                            let iw = ow * stride + kw;
                            sum += input.data[bn * in_stride_n + ch * in_stride_c + ih * w + iw];
                        }
                    }
                    out_data[bn * out_stride_n + ch * out_stride_c + oh * out_w + ow] = sum / window;
                }
            }
        }
    }

    Ok(Tensor::new(out_data, vec![n, c, out_h, out_w]))
}

/// Batch normalization for 4D tensors (conv outputs).
///
/// For each channel c, across the batch and spatial dims:
///   1. Compute mean μ and variance σ²
///   2. Normalize: x̂ = (x - μ) / sqrt(σ² + eps)
///   3. Scale and shift: y = gamma[c] * x̂ + beta[c]
///
/// # Why it works
/// Each mini-batch has a different distribution. BN re-centers and re-scales
/// each channel so the next layer always sees stable input statistics.
/// This is why training is faster — gradients don't have to fight shifting inputs.
///
/// `gamma` and `beta` are learnable: the network can undo normalization if needed.
pub fn batch_norm2d(
    input: &Tensor,
    gamma: &[f32],
    beta: &[f32],
    eps: f32,
) -> Result<Tensor, String> {
    validate_4d(input, "batch_norm2d")?;
    let (n, c, h, w) = dims4(input);

    if gamma.len() != c || beta.len() != c {
        return Err(format!(
            "batch_norm2d: gamma/beta must have length {} (one per channel), got {}/{}",
            c, gamma.len(), beta.len()
        ));
    }

    let spatial = h * w;
    let count = (n * spatial) as f32; // elements per channel across batch + spatial
    let mut out_data = vec![0.0f32; input.data.len()];

    let in_stride_n = c * h * w;
    let in_stride_c = h * w;

    for ch in 0..c {
        // Compute mean for this channel
        let mut mean = 0.0f32;
        for bn in 0..n {
            for s in 0..spatial {
                mean += input.data[bn * in_stride_n + ch * in_stride_c + s];
            }
        }
        mean /= count;

        // Compute variance
        let mut var = 0.0f32;
        for bn in 0..n {
            for s in 0..spatial {
                let diff = input.data[bn * in_stride_n + ch * in_stride_c + s] - mean;
                var += diff * diff;
            }
        }
        var /= count;

        let inv_std = 1.0 / (var + eps).sqrt();

        // Normalize, scale, shift
        for bn in 0..n {
            for s in 0..spatial {
                let idx = bn * in_stride_n + ch * in_stride_c + s;
                let x_hat = (input.data[idx] - mean) * inv_std;
                out_data[idx] = gamma[ch] * x_hat + beta[ch];
            }
        }
    }

    Ok(Tensor::new(out_data, input.shape.clone()))
}

/// Global average pooling: collapse H and W entirely, leaving [N, C].
///
/// Takes the mean over all spatial positions for each channel.
/// Standard bridge between conv layers and the final classifier:
/// instead of flattening (which is position-sensitive), you summarize
/// "how much of feature c appeared anywhere in this image".
pub fn global_avg_pool2d(input: &Tensor) -> Result<Tensor, String> {
    validate_4d(input, "global_avg_pool2d")?;
    let (n, c, h, w) = dims4(input);
    let spatial = (h * w) as f32;
    let mut out_data = vec![0.0f32; n * c];

    let in_stride_n = c * h * w;
    let in_stride_c = h * w;

    for bn in 0..n {
        for ch in 0..c {
            let mut sum = 0.0f32;
            for s in 0..h * w {
                sum += input.data[bn * in_stride_n + ch * in_stride_c + s];
            }
            out_data[bn * c + ch] = sum / spatial;
        }
    }

    Ok(Tensor::new(out_data, vec![n, c]))
}

/// ReLU activation: max(0, x) element-wise.
/// The most common activation after conv layers.
pub fn relu(input: &Tensor) -> Tensor {
    let data = input.data.iter().map(|&x| x.max(0.0)).collect();
    Tensor::new(data, input.shape.clone())
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn validate_4d(t: &Tensor, op: &str) -> Result<(), String> {
    if t.shape.len() != 4 {
        Err(format!("{}: input must be 4D [N,C,H,W], got {:?}", op, t.shape))
    } else {
        Ok(())
    }
}

fn dims4(t: &Tensor) -> (usize, usize, usize, usize) {
    (t.shape[0], t.shape[1], t.shape[2], t.shape[3])
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_tensor(data: Vec<f32>, shape: Vec<usize>) -> Tensor {
        Tensor::new(data, shape)
    }

    #[test]
    fn test_conv2d_single_channel_identity() {
        // 1 batch, 1 channel, 3×3 input, 3×3 kernel that's an identity (center=1, rest=0)
        let input = make_tensor(
            vec![1., 2., 3., 4., 5., 6., 7., 8., 9.],
            vec![1, 1, 3, 3],
        );
        let kernel = make_tensor(
            vec![0., 0., 0., 0., 1., 0., 0., 0., 0.], // identity kernel
            vec![1, 1, 3, 3],
        );
        let out = conv2d(&input, &kernel, None, 1, 1).unwrap();
        assert_eq!(out.shape, vec![1, 1, 3, 3]);
        // With padding=1 and identity kernel, output should equal input
        let diff: f32 = out.data.iter().zip(input.data.iter()).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff < 1e-5, "Identity conv failed, diff={}", diff);
    }

    #[test]
    fn test_conv2d_output_shape() {
        // [1, 1, 5, 5] input, [2, 1, 3, 3] kernel, stride=1, pad=0 → [1, 2, 3, 3]
        let input  = make_tensor(vec![1.0; 25], vec![1, 1, 5, 5]);
        let kernel = make_tensor(vec![1.0; 18], vec![2, 1, 3, 3]);
        let out = conv2d(&input, &kernel, None, 1, 0).unwrap();
        assert_eq!(out.shape, vec![1, 2, 3, 3]);
        // Each output = sum of 9 ones * 1.0 = 9.0
        assert!((out.data[0] - 9.0).abs() < 1e-5);
    }

    #[test]
    fn test_max_pool2d() {
        // [1, 1, 4, 4] input, 2×2 pool, stride=2 → [1, 1, 2, 2]
        #[rustfmt::skip]
        let input = make_tensor(
            vec![1., 3., 2., 4.,
                 5., 6., 7., 8.,
                 9., 2., 3., 1.,
                 0., 4., 5., 6.],
            vec![1, 1, 4, 4],
        );
        let res = max_pool2d(&input, 2, 2).unwrap();
        assert_eq!(res.output.shape, vec![1, 1, 2, 2]);
        // Top-left 2×2: max(1,3,5,6)=6; top-right: max(2,4,7,8)=8
        // Bot-left: max(9,2,0,4)=9; bot-right: max(3,1,5,6)=6
        assert_eq!(res.output.data, vec![6., 8., 9., 6.]);
    }

    #[test]
    fn test_avg_pool2d() {
        let input = make_tensor(vec![1., 2., 3., 4.], vec![1, 1, 2, 2]);
        let out = avg_pool2d(&input, 2, 1).unwrap();
        assert_eq!(out.shape, vec![1, 1, 1, 1]);
        assert!((out.data[0] - 2.5).abs() < 1e-5);
    }

    #[test]
    fn test_batch_norm2d_zero_mean() {
        // If input is already zero-mean, with gamma=1 beta=0, output should equal input
        let input = make_tensor(vec![-1., 1., -1., 1.], vec![1, 1, 2, 2]);
        let out = batch_norm2d(&input, &[1.0], &[0.0], 1e-5).unwrap();
        // After normalization the values should be ±1 (since std=1 for [-1,-1,1,1])
        assert_eq!(out.shape, input.shape);
        let sum: f32 = out.data.iter().sum();
        assert!(sum.abs() < 1e-4, "batch_norm output should sum to ~0, got {}", sum);
    }

    #[test]
    fn test_global_avg_pool2d() {
        // [1, 2, 2, 2]: channel 0 = [1,2,3,4] avg=2.5, channel 1 = [5,6,7,8] avg=6.5
        let input = make_tensor(
            vec![1., 2., 3., 4., 5., 6., 7., 8.],
            vec![1, 2, 2, 2],
        );
        let out = global_avg_pool2d(&input).unwrap();
        assert_eq!(out.shape, vec![1, 2]);
        assert!((out.data[0] - 2.5).abs() < 1e-5);
        assert!((out.data[1] - 6.5).abs() < 1e-5);
    }

    #[test]
    fn test_relu() {
        let input = make_tensor(vec![-2., -0.5, 0., 0.5, 2.], vec![1, 1, 1, 5]);
        let out = relu(&input);
        assert_eq!(out.data, vec![0., 0., 0., 0.5, 2.]);
    }
}
