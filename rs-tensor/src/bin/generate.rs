use std::io::BufReader;
use rs_tensor::gguf::GgufFile;
use rs_tensor::llama::{self, LlamaModel};

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "model-files/stories15M-f32.gguf".to_string());

    println!("Loading model from {}...", path);
    let file = std::fs::File::open(&path).expect("Failed to open GGUF file");
    let reader = BufReader::new(file);
    let mut gguf = GgufFile::parse(reader).expect("Failed to parse GGUF");

    println!("{}", gguf.summary());

    // Extract vocabulary before loading model
    let vocab = llama::extract_vocab(&gguf);
    println!("Vocabulary: {} tokens", vocab.len());

    let model = LlamaModel::from_gguf(&mut gguf).expect("Failed to load model");
    println!(
        "Model loaded: dim={}, layers={}, heads={}, vocab={}, ffn={}",
        model.config.dim,
        model.config.n_layers,
        model.config.n_heads,
        model.config.vocab_size,
        model.config.ffn_dim,
    );

    // Generate from BOS token (token 1 in LLaMA tokenizer)
    let bos = 1;
    let max_tokens = 50;
    println!("\nGenerating {} tokens (greedy, from BOS)...\n", max_tokens);

    let start = std::time::Instant::now();
    let tokens = model.generate(&[bos], max_tokens, 0.0);
    let elapsed = start.elapsed();

    if !vocab.is_empty() {
        let text = llama::decode_tokens(&vocab, &tokens);
        println!("Output:{}", text);
    } else {
        println!("Token IDs: {:?}", tokens);
    }

    println!(
        "\n({} tokens in {:.2?}, {:.1} tok/s)",
        tokens.len(),
        elapsed,
        tokens.len() as f64 / elapsed.as_secs_f64()
    );
}
