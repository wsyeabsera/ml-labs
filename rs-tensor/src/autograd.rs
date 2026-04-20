//! # Autograd module
//!
//! A scalar autograd engine inspired by Karpathy's micrograd.
//! Each `Value` records the operation that created it, forming a
//! computation graph. Calling `backward()` on the output walks the
//! graph in reverse topological order, filling in gradients via
//! the chain rule.

use std::cell::RefCell;
use std::collections::HashSet;
use std::fmt;
use std::rc::Rc;

/// The operation that produced a `Value`.
/// Each variant stores the inputs so we can compute local gradients
/// during the backward pass.
#[derive(Clone)]
enum Op {
    /// No operation — this is a leaf value (input/weight).
    None,
    /// Result of a + b.
    Add(Value, Value),
    /// Result of a * b.
    Mul(Value, Value),
    /// Result of tanh(a).
    Tanh(Value),
}

/// Internal data for a `Value` node in the computation graph.
struct ValueData {
    /// The scalar value (forward pass result).
    data: f32,
    /// The accumulated gradient (filled in by backward).
    grad: f32,
    /// The operation that created this value.
    op: Op,
    /// A label for debugging (optional).
    label: String,
}

/// A handle to a node in the computation graph.
///
/// Uses `Rc<RefCell<...>>` because:
/// - `Rc`: multiple values can share the same input (e.g. `a` used in both `a+b` and `a*c`).
/// - `RefCell`: we need to mutate `grad` during backward even though the graph is shared.
#[derive(Clone)]
pub struct Value(Rc<RefCell<ValueData>>);

impl Value {
    /// Create a new leaf value (no operation, no parents).
    pub fn new(data: f32, label: &str) -> Self {
        Value(Rc::new(RefCell::new(ValueData {
            data,
            grad: 0.0,
            op: Op::None,
            label: label.to_string(),
        })))
    }

    /// Get the scalar value.
    pub fn data(&self) -> f32 {
        self.0.borrow().data
    }

    /// Get the gradient.
    pub fn grad(&self) -> f32 {
        self.0.borrow().grad
    }

    /// Get the label.
    pub fn label(&self) -> String {
        self.0.borrow().label.clone()
    }

    /// tanh activation: `tanh(self)`.
    ///
    /// Local gradient: `d(tanh(x))/dx = 1 - tanh(x)^2`.
    pub fn tanh(&self) -> Value {
        let t = self.data().tanh();
        Value(Rc::new(RefCell::new(ValueData {
            data: t,
            grad: 0.0,
            op: Op::Tanh(self.clone()),
            label: format!("tanh({})", self.label()),
        })))
    }

    /// Run backpropagation from this value.
    ///
    /// Sets this value's gradient to 1.0 (it's the output), then walks
    /// the graph in reverse topological order, propagating gradients
    /// via the chain rule.
    pub fn backward(&self) {
        // Build topological order
        let mut topo: Vec<Value> = Vec::new();
        let mut visited: HashSet<*const RefCell<ValueData>> = HashSet::new();
        self.build_topo(&mut topo, &mut visited);

        // Set output gradient to 1.0
        self.0.borrow_mut().grad = 1.0;

        // Walk in reverse topological order
        for node in topo.iter().rev() {
            let op = node.0.borrow().op.clone();
            let node_grad = node.0.borrow().grad;

            match op {
                Op::None => {}
                Op::Add(a, b) => {
                    // d(a+b)/da = 1, d(a+b)/db = 1
                    a.0.borrow_mut().grad += node_grad;
                    b.0.borrow_mut().grad += node_grad;
                }
                Op::Mul(a, b) => {
                    // d(a*b)/da = b, d(a*b)/db = a
                    let a_data = a.data();
                    let b_data = b.data();
                    a.0.borrow_mut().grad += b_data * node_grad;
                    b.0.borrow_mut().grad += a_data * node_grad;
                }
                Op::Tanh(a) => {
                    // d(tanh(x))/dx = 1 - tanh(x)^2
                    let t = node.data();
                    a.0.borrow_mut().grad += (1.0 - t * t) * node_grad;
                }
            }
        }
    }

    /// Build topological order via depth-first traversal.
    fn build_topo(
        &self,
        topo: &mut Vec<Value>,
        visited: &mut HashSet<*const RefCell<ValueData>>,
    ) {
        let ptr = Rc::as_ptr(&self.0);
        if visited.contains(&ptr) {
            return;
        }
        visited.insert(ptr);

        match &self.0.borrow().op {
            Op::None => {}
            Op::Add(a, b) | Op::Mul(a, b) => {
                a.build_topo(topo, visited);
                b.build_topo(topo, visited);
            }
            Op::Tanh(a) => {
                a.build_topo(topo, visited);
            }
        }

        topo.push(self.clone());
    }
}

// ── Operator overloads ──────────────────────────────────────────────

impl std::ops::Add for &Value {
    type Output = Value;

    fn add(self, rhs: &Value) -> Value {
        Value(Rc::new(RefCell::new(ValueData {
            data: self.data() + rhs.data(),
            grad: 0.0,
            op: Op::Add(self.clone(), rhs.clone()),
            label: format!("({}+{})", self.label(), rhs.label()),
        })))
    }
}

impl std::ops::Mul for &Value {
    type Output = Value;

    fn mul(self, rhs: &Value) -> Value {
        Value(Rc::new(RefCell::new(ValueData {
            data: self.data() * rhs.data(),
            grad: 0.0,
            op: Op::Mul(self.clone(), rhs.clone()),
            label: format!("({}*{})", self.label(), rhs.label()),
        })))
    }
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let inner = self.0.borrow();
        write!(
            f,
            "Value({}: data={:.4}, grad={:.4})",
            inner.label, inner.data, inner.grad
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_add_backward() {
        let a = Value::new(2.0, "a");
        let b = Value::new(3.0, "b");
        let c = &a + &b; // c = a + b = 5
        c.backward();

        assert_eq!(c.data(), 5.0);
        assert_eq!(a.grad(), 1.0); // dc/da = 1
        assert_eq!(b.grad(), 1.0); // dc/db = 1
    }

    #[test]
    fn test_simple_mul_backward() {
        let a = Value::new(2.0, "a");
        let b = Value::new(3.0, "b");
        let c = &a * &b; // c = a * b = 6
        c.backward();

        assert_eq!(c.data(), 6.0);
        assert_eq!(a.grad(), 3.0); // dc/da = b = 3
        assert_eq!(b.grad(), 2.0); // dc/db = a = 2
    }

    #[test]
    fn test_chain() {
        // c = a * b, d = c + a → tests that `a` gets gradient from both paths
        let a = Value::new(2.0, "a");
        let b = Value::new(3.0, "b");
        let c = &a * &b; // c = 6
        let d = &c + &a; // d = 6 + 2 = 8
        d.backward();

        assert_eq!(d.data(), 8.0);
        // dd/da = dd/dc * dc/da + dd/da(direct) = 1*3 + 1 = 4
        assert_eq!(a.grad(), 4.0);
        // dd/db = dd/dc * dc/db = 1*2 = 2
        assert_eq!(b.grad(), 2.0);
    }

    #[test]
    fn test_tanh_backward() {
        let x = Value::new(0.0, "x");
        let y = x.tanh(); // tanh(0) = 0
        y.backward();

        assert_eq!(y.data(), 0.0);
        // d(tanh(0))/dx = 1 - 0^2 = 1.0
        assert!((x.grad() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_neuron() {
        // A single neuron: out = tanh(x1*w1 + x2*w2 + b)
        let x1 = Value::new(2.0, "x1");
        let x2 = Value::new(0.0, "x2");
        let w1 = Value::new(-3.0, "w1");
        let w2 = Value::new(1.0, "w2");
        let b = Value::new(6.8814, "b");

        let x1w1 = &x1 * &w1;
        let x2w2 = &x2 * &w2;
        let sum = &x1w1 + &x2w2;
        let out = &sum + &b;
        let activated = out.tanh();
        activated.backward();

        // tanh(2*-3 + 0*1 + 6.8814) = tanh(0.8814) ≈ 0.7071
        assert!((activated.data() - 0.7071).abs() < 0.01);
        // Check gradients are populated (exact values depend on tanh derivative)
        assert!(w1.grad().abs() > 0.0);
        assert!(x1.grad().abs() > 0.0);
    }
}
