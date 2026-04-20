use rs_tensor::tensor::Tensor;

fn main() {
    // 1D add
    let t1 = Tensor::new(vec![1.0, 2.0, 3.0], vec![3]);
    let t2 = Tensor::new(vec![4.0, 5.0, 6.0], vec![3]);
    let t3 = t1.add(&t2);
    println!("add: {:?}", t3);

    // 2D tensor with strides
    let m = Tensor::new(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0], vec![2, 3]);
    println!("m shape={:?}, strides={:?}", m.shape, m.strides);
    println!("m[1,2] via get_2d = {:?}", m.get_2d(1, 2)); // Some(6.0)
    println!("m[1,2] via get    = {:?}", m.get(&[1, 2]));  // Some(6.0)

    // 3D tensor: N-dim get
    let t3d = Tensor::new((0..24).map(|i| i as f32).collect(), vec![2, 3, 4]);
    println!("\n3D tensor: shape={:?}, strides={:?}", t3d.shape, t3d.strides);
    println!("t3d[1,2,3] = {:?}", t3d.get(&[1, 2, 3])); // Some(23.0)

    // Element-wise mul
    let a = Tensor::new(vec![1.0, 2.0, 3.0, 4.0], vec![2, 2]);
    let b = Tensor::new(vec![5.0, 6.0, 7.0, 8.0], vec![2, 2]);
    println!("\nmul: {:?}", a.mul(&b));

    // Reshape: 2x3 → 3x2
    let reshaped = m.reshape(vec![3, 2]).unwrap();
    println!("\nreshaped 2x3 → 3x2: shape={:?}, data={:?}", reshaped.shape, reshaped.data);

    // Transpose: swap rows and cols
    let mt = m.transpose(0, 1).unwrap();
    println!("\ntranspose 2x3 → 3x2:");
    println!("  shape={:?}, strides={:?}", mt.shape, mt.strides);
    // Read elements in logical order to see the transposed view
    for r in 0..mt.shape[0] {
        for c in 0..mt.shape[1] {
            print!("{:4.0}", mt.get(&[r, c]).unwrap());
        }
        println!();
    }
}
