//! # Tensor-level autograd
//!
//! Extends the scalar autograd idea to tensors. A `TensorValue` wraps a `Tensor`
//! and records operations in a computation graph, just like `Value` does for scalars.
//! Calling `backward()` propagates gradient tensors through the graph.

use std::cell::RefCell;
use std::collections::HashSet;
use std::fmt;
use std::rc::Rc;

use crate::tensor::Tensor;

/// Operations that produce a `TensorValue`.
#[derive(Clone)]
enum TensorOp {
    /// Leaf node — no operation produced this (it's an input or weight).
    None,
    /// Element-wise addition: c = a + b.
    Add(TensorValue, TensorValue),
    /// Element-wise multiplication: c = a * b (Hadamard product).
    Mul(TensorValue, TensorValue),
    /// Matrix multiplication: c = a @ b.
    MatMul(TensorValue, TensorValue),
    /// tanh applied element-wise.
    Tanh(TensorValue),
    /// Transpose (swap two dims).
    Transpose(TensorValue, usize, usize),
    /// Row-wise softmax.
    Softmax(TensorValue),
    /// Sum all elements to a scalar.
    Sum(TensorValue),
}

/// Internal data for a tensor node in the computation graph.
struct TensorValueData {
    data: Tensor,
    grad: Tensor,
    op: TensorOp,
    label: String,
}

/// A handle to a tensor node in the computation graph.
///
/// Same pattern as scalar `Value`: `Rc<RefCell<...>>` for shared ownership
/// and interior mutability during backward.
#[derive(Clone)]
pub struct TensorValue(Rc<RefCell<TensorValueData>>);

impl TensorValue {
    /// Create a new leaf tensor value.
    pub fn new(data: Tensor, label: &str) -> Self {
        let grad = Tensor::zeros(data.shape.clone());
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            data,
            grad,
            op: TensorOp::None,
            label: label.to_string(),
        })))
    }

    /// Get a clone of the tensor data.
    pub fn data(&self) -> Tensor {
        self.0.borrow().data.clone()
    }

    /// Get a clone of the gradient tensor.
    pub fn grad(&self) -> Tensor {
        self.0.borrow().grad.clone()
    }

    /// Get the label.
    pub fn label(&self) -> String {
        self.0.borrow().label.clone()
    }

    /// Element-wise addition.
    pub fn add(&self, other: &TensorValue) -> TensorValue {
        let result = self.data().add(&other.data());
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Add(self.clone(), other.clone()),
            label: format!("({}+{})", self.label(), other.label()),
        })))
    }

    /// Element-wise multiplication (Hadamard product).
    pub fn mul(&self, other: &TensorValue) -> TensorValue {
        let result = self.data().mul(&other.data());
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Mul(self.clone(), other.clone()),
            label: format!("({}*{})", self.label(), other.label()),
        })))
    }

    /// Matrix multiplication.
    pub fn matmul(&self, other: &TensorValue) -> TensorValue {
        let result = self.data().matmul(&other.data());
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::MatMul(self.clone(), other.clone()),
            label: format!("({}@{})", self.label(), other.label()),
        })))
    }

    /// Element-wise tanh.
    pub fn tanh(&self) -> TensorValue {
        let data = self.data();
        let tanh_data: Vec<f32> = data.data.iter().map(|x| x.tanh()).collect();
        let result = Tensor::new(tanh_data, data.shape.clone());
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Tanh(self.clone()),
            label: format!("tanh({})", self.label()),
        })))
    }

    /// Transpose: swap two dimensions (tracked in the graph).
    pub fn transpose(&self, dim0: usize, dim1: usize) -> TensorValue {
        let result = self.data().transpose(dim0, dim1).unwrap();
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Transpose(self.clone(), dim0, dim1),
            label: format!("{}^T", self.label()),
        })))
    }

    /// Row-wise softmax (2D only).
    pub fn softmax(&self) -> TensorValue {
        let result = self.data().softmax();
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Softmax(self.clone()),
            label: format!("softmax({})", self.label()),
        })))
    }

    /// Scale every element by a scalar.
    pub fn scale(&self, scalar: f32) -> TensorValue {
        let result = self.data().scale(scalar);
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Mul(
                self.clone(),
                TensorValue::new(
                    Tensor::new(vec![scalar; self.data().data.len()], self.data().shape.clone()),
                    "scalar",
                ),
            ),
            label: format!("scale({})", self.label()),
        })))
    }

    /// Sum all elements to a scalar tensor (shape [1]).
    pub fn sum(&self) -> TensorValue {
        let result = self.data().sum();
        TensorValue(Rc::new(RefCell::new(TensorValueData {
            grad: Tensor::zeros(result.shape.clone()),
            data: result,
            op: TensorOp::Sum(self.clone()),
            label: format!("sum({})", self.label()),
        })))
    }

    /// Run backpropagation from this tensor value.
    ///
    /// Sets this value's gradient to all ones (same shape), then walks
    /// the graph in reverse topological order propagating gradients.
    pub fn backward(&self) {
        let mut topo: Vec<TensorValue> = Vec::new();
        let mut visited: HashSet<*const RefCell<TensorValueData>> = HashSet::new();
        self.build_topo(&mut topo, &mut visited);

        // Seed: gradient of output with respect to itself is 1
        {
            let shape = self.0.borrow().data.shape.clone();
            self.0.borrow_mut().grad = Tensor::ones(shape);
        }

        for node in topo.iter().rev() {
            let op = node.0.borrow().op.clone();
            let node_grad = node.0.borrow().grad.clone();

            match op {
                TensorOp::None => {}
                TensorOp::Add(a, b) => {
                    // d(a+b)/da = 1, d(a+b)/db = 1
                    // grad passes through to both inputs
                    let a_grad = a.0.borrow().grad.add(&node_grad);
                    a.0.borrow_mut().grad = a_grad;
                    let b_grad = b.0.borrow().grad.add(&node_grad);
                    b.0.borrow_mut().grad = b_grad;
                }
                TensorOp::Mul(a, b) => {
                    // d(a*b)/da = b, d(a*b)/db = a (element-wise)
                    let a_data = a.data();
                    let b_data = b.data();
                    let a_grad = a.0.borrow().grad.add(&b_data.mul(&node_grad));
                    a.0.borrow_mut().grad = a_grad;
                    let b_grad = b.0.borrow().grad.add(&a_data.mul(&node_grad));
                    b.0.borrow_mut().grad = b_grad;
                }
                TensorOp::MatMul(a, b) => {
                    // c = a @ b  where a: [M,K], b: [K,N], c: [M,N]
                    // dc/da = grad @ b^T   → [M,N] @ [N,K] = [M,K]
                    // dc/db = a^T @ grad   → [K,M] @ [M,N] = [K,N]
                    let a_data = a.data();
                    let b_data = b.data();
                    let bt = b_data.transpose(0, 1).unwrap();
                    let at = a_data.transpose(0, 1).unwrap();

                    let da = node_grad.matmul(&bt);
                    let db = at.matmul(&node_grad);

                    let a_grad = a.0.borrow().grad.add(&da);
                    a.0.borrow_mut().grad = a_grad;
                    let b_grad = b.0.borrow().grad.add(&db);
                    b.0.borrow_mut().grad = b_grad;
                }
                TensorOp::Tanh(a) => {
                    // d(tanh(x))/dx = 1 - tanh(x)^2, element-wise
                    let out_data = node.data();
                    let one_minus_sq: Vec<f32> = out_data
                        .data
                        .iter()
                        .map(|t| 1.0 - t * t)
                        .collect();
                    let deriv = Tensor::new(one_minus_sq, out_data.shape.clone());
                    let a_grad = a.0.borrow().grad.add(&deriv.mul(&node_grad));
                    a.0.borrow_mut().grad = a_grad;
                }
                TensorOp::Transpose(a, dim0, dim1) => {
                    // Transpose gradient: transpose grad back, then materialize
                    // to contiguous layout since add() doesn't respect strides.
                    let grad_transposed = node_grad.transpose(dim0, dim1).unwrap();
                    let grad_contiguous = grad_transposed
                        .reshape(grad_transposed.shape.clone())
                        .unwrap();
                    let a_grad = a.0.borrow().grad.add(&grad_contiguous);
                    a.0.borrow_mut().grad = a_grad;
                }
                TensorOp::Softmax(a) => {
                    // softmax backward: dx_ij = s_ij * (dout_ij - sum_j(dout_ij * s_ij))
                    // Per row: dx = s * (dout - dot(dout, s))
                    let s = node.data();
                    let rows = s.shape[0];
                    let cols = s.shape[1];
                    let mut dx = vec![0.0f32; s.data.len()];

                    for i in 0..rows {
                        let start = i * cols;
                        // dot(dout_row, s_row)
                        let mut dot = 0.0f32;
                        for j in 0..cols {
                            dot += node_grad.data[start + j] * s.data[start + j];
                        }
                        for j in 0..cols {
                            dx[start + j] = s.data[start + j] * (node_grad.data[start + j] - dot);
                        }
                    }

                    let dx_tensor = Tensor::new(dx, s.shape.clone());
                    let a_grad = a.0.borrow().grad.add(&dx_tensor);
                    a.0.borrow_mut().grad = a_grad;
                }
                TensorOp::Sum(a) => {
                    // d(sum(x))/dx_i = 1 for all i
                    // grad is scalar (shape [1]), broadcast to input shape
                    let scalar = node_grad.data[0];
                    let a_shape = a.0.borrow().data.shape.clone();
                    let broadcast = Tensor::ones(a_shape).scale(scalar);
                    let a_grad = a.0.borrow().grad.add(&broadcast);
                    a.0.borrow_mut().grad = a_grad;
                }
            }
        }
    }

    fn build_topo(
        &self,
        topo: &mut Vec<TensorValue>,
        visited: &mut HashSet<*const RefCell<TensorValueData>>,
    ) {
        let ptr = Rc::as_ptr(&self.0);
        if visited.contains(&ptr) {
            return;
        }
        visited.insert(ptr);

        match &self.0.borrow().op {
            TensorOp::None => {}
            TensorOp::Add(a, b) | TensorOp::Mul(a, b) | TensorOp::MatMul(a, b) => {
                a.build_topo(topo, visited);
                b.build_topo(topo, visited);
            }
            TensorOp::Transpose(a, _, _)
            | TensorOp::Tanh(a)
            | TensorOp::Softmax(a)
            | TensorOp::Sum(a) => {
                a.build_topo(topo, visited);
            }
        }

        topo.push(self.clone());
    }
}

impl fmt::Debug for TensorValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let inner = self.0.borrow();
        write!(
            f,
            "TensorValue({}: shape={:?}, data={:?}, grad={:?})",
            inner.label, inner.data.shape, inner.data.data, inner.grad.data
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_backward() {
        let a = TensorValue::new(Tensor::new(vec![1.0, 2.0, 3.0], vec![3]), "a");
        let b = TensorValue::new(Tensor::new(vec![4.0, 5.0, 6.0], vec![3]), "b");
        let c = a.add(&b);
        c.backward();

        assert_eq!(c.data().data, vec![5.0, 7.0, 9.0]);
        // dc/da = 1, dc/db = 1
        assert_eq!(a.grad().data, vec![1.0, 1.0, 1.0]);
        assert_eq!(b.grad().data, vec![1.0, 1.0, 1.0]);
    }

    #[test]
    fn test_mul_backward() {
        let a = TensorValue::new(Tensor::new(vec![2.0, 3.0], vec![2]), "a");
        let b = TensorValue::new(Tensor::new(vec![4.0, 5.0], vec![2]), "b");
        let c = a.mul(&b);
        c.backward();

        assert_eq!(c.data().data, vec![8.0, 15.0]);
        // dc/da = b, dc/db = a
        assert_eq!(a.grad().data, vec![4.0, 5.0]);
        assert_eq!(b.grad().data, vec![2.0, 3.0]);
    }

    #[test]
    fn test_matmul_backward() {
        // a: [2, 3], b: [3, 2] → c: [2, 2]
        let a = TensorValue::new(
            Tensor::new(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0], vec![2, 3]),
            "a",
        );
        let b = TensorValue::new(
            Tensor::new(vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0], vec![3, 2]),
            "b",
        );
        let c = a.matmul(&b);
        c.backward();

        // c = [[58, 64], [139, 154]]
        assert_eq!(c.data().data, vec![58.0, 64.0, 139.0, 154.0]);

        // dc/da = grad @ b^T = ones[2,2] @ b^T[2,3]
        // b^T = [[7,9,11],[8,10,12]]
        // a_grad = [[15, 19, 23], [15, 19, 23]]
        assert_eq!(a.grad().data, vec![15.0, 19.0, 23.0, 15.0, 19.0, 23.0]);

        // dc/db = a^T @ grad = a^T[3,2] @ ones[2,2]
        // a^T = [[1,4],[2,5],[3,6]]
        // b_grad = [[5, 5], [7, 7], [9, 9]]
        assert_eq!(b.grad().data, vec![5.0, 5.0, 7.0, 7.0, 9.0, 9.0]);
    }

    #[test]
    fn test_tanh_backward() {
        let x = TensorValue::new(Tensor::new(vec![0.0, 1.0], vec![2]), "x");
        let y = x.tanh();
        y.backward();

        let tanh_0 = 0.0_f32.tanh();
        let tanh_1 = 1.0_f32.tanh();
        assert!((y.data().data[0] - tanh_0).abs() < 1e-6);
        assert!((y.data().data[1] - tanh_1).abs() < 1e-6);

        // grad = 1 - tanh(x)^2
        let expected_grad_0 = 1.0 - tanh_0 * tanh_0;
        let expected_grad_1 = 1.0 - tanh_1 * tanh_1;
        assert!((x.grad().data[0] - expected_grad_0).abs() < 1e-6);
        assert!((x.grad().data[1] - expected_grad_1).abs() < 1e-6);
    }

    #[test]
    fn test_sum_backward() {
        let x = TensorValue::new(Tensor::new(vec![1.0, 2.0, 3.0], vec![3]), "x");
        let s = x.sum();
        s.backward();

        assert_eq!(s.data().data, vec![6.0]);
        // d(sum)/dx_i = 1 for all i
        assert_eq!(x.grad().data, vec![1.0, 1.0, 1.0]);
    }

    #[test]
    fn test_chain_matmul_add_tanh() {
        // Simple neural network layer: out = tanh(x @ w + b)
        let x = TensorValue::new(
            Tensor::new(vec![1.0, 2.0], vec![1, 2]),
            "x",
        );
        let w = TensorValue::new(
            Tensor::new(vec![0.5, -0.5], vec![2, 1]),
            "w",
        );
        let b = TensorValue::new(
            Tensor::new(vec![0.1], vec![1, 1]),
            "b",
        );

        let xw = x.matmul(&w);     // [1,2] @ [2,1] = [1,1] → [-0.5]
        let pre = xw.add(&b);       // [-0.5 + 0.1] = [-0.4]
        let out = pre.tanh();        // tanh(-0.4)
        out.backward();

        let expected = (-0.4_f32).tanh();
        assert!((out.data().data[0] - expected).abs() < 1e-6);

        // All gradients should be non-zero
        assert!(w.grad().data.iter().all(|g| g.abs() > 0.0));
        assert!(b.grad().data.iter().all(|g| g.abs() > 0.0));
        assert!(x.grad().data.iter().all(|g| g.abs() > 0.0));
    }
}
