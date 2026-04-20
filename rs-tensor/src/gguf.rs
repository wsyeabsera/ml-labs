//! # GGUF model file parser
//!
//! Parses the GGUF (GGML Universal File) format used by llama.cpp and others.
//! GGUF packs everything needed for inference into one file:
//! - Model metadata (architecture, context length, vocab size, etc.)
//! - Tensor metadata (name, shape, data type, offset into file)
//! - Raw tensor data (the actual weights)
//!
//! We support loading F32 and F16 tensors into our `Tensor` type.

use std::collections::HashMap;
use std::io::{self, Read, Seek, SeekFrom};

use crate::tensor::Tensor;

const GGUF_MAGIC: u32 = 0x46554747; // "GGUF" as little-endian u32: bytes [0x47, 0x47, 0x55, 0x46]

/// GGUF value types (from the spec).
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u32)]
pub enum GgufValueType {
    Uint8 = 0,
    Int8 = 1,
    Uint16 = 2,
    Int16 = 3,
    Uint32 = 4,
    Int32 = 5,
    Float32 = 6,
    Bool = 7,
    String = 8,
    Array = 9,
    Uint64 = 10,
    Int64 = 11,
    Float64 = 12,
}

impl GgufValueType {
    fn from_u32(v: u32) -> Option<Self> {
        match v {
            0 => Some(Self::Uint8),
            1 => Some(Self::Int8),
            2 => Some(Self::Uint16),
            3 => Some(Self::Int16),
            4 => Some(Self::Uint32),
            5 => Some(Self::Int32),
            6 => Some(Self::Float32),
            7 => Some(Self::Bool),
            8 => Some(Self::String),
            9 => Some(Self::Array),
            10 => Some(Self::Uint64),
            11 => Some(Self::Int64),
            12 => Some(Self::Float64),
            _ => None,
        }
    }
}

/// GGML tensor data types.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GgmlDtype {
    F32,
    F16,
    Q4_0,
    Q4_1,
    Q5_0,
    Q5_1,
    Q8_0,
    Q8_1,
    Q2K,
    Q3K,
    Q4K,
    Q5K,
    Q6K,
    Other(u32),
}

impl GgmlDtype {
    fn from_u32(v: u32) -> Self {
        match v {
            0 => Self::F32,
            1 => Self::F16,
            2 => Self::Q4_0,
            3 => Self::Q4_1,
            6 => Self::Q5_0,
            7 => Self::Q5_1,
            8 => Self::Q8_0,
            9 => Self::Q8_1,
            10 => Self::Q2K,
            11 => Self::Q3K,
            12 => Self::Q4K,
            13 => Self::Q5K,
            14 => Self::Q6K,
            _ => Self::Other(v),
        }
    }
}

/// A metadata value from the GGUF file.
#[derive(Debug, Clone)]
pub enum MetadataValue {
    Uint8(u8),
    Int8(i8),
    Uint16(u16),
    Int16(i16),
    Uint32(u32),
    Int32(i32),
    Float32(f32),
    Bool(bool),
    String(String),
    Array(Vec<MetadataValue>),
    Uint64(u64),
    Int64(i64),
    Float64(f64),
}

impl MetadataValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            MetadataValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        match self {
            MetadataValue::Uint32(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            MetadataValue::Uint64(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_f32(&self) -> Option<f32> {
        match self {
            MetadataValue::Float32(v) => Some(*v),
            _ => None,
        }
    }
}

/// Info about a tensor stored in the GGUF file (before loading data).
#[derive(Debug, Clone)]
pub struct TensorInfo {
    pub name: String,
    pub shape: Vec<usize>,
    pub dtype: GgmlDtype,
    pub offset: u64,
}

impl TensorInfo {
    /// Total number of elements.
    pub fn num_elements(&self) -> usize {
        self.shape.iter().product()
    }
}

/// A parsed GGUF file.
pub struct GgufFile<R: Read + Seek> {
    pub version: u32,
    pub metadata: HashMap<String, MetadataValue>,
    pub tensor_infos: Vec<TensorInfo>,
    /// Offset in the file where tensor data begins.
    data_offset: u64,
    reader: R,
}

impl<R: Read + Seek> GgufFile<R> {
    /// Parse a GGUF file from a reader.
    pub fn parse(mut reader: R) -> io::Result<Self> {
        // Header: magic (4 bytes), version (4), tensor_count (8), metadata_kv_count (8)
        let magic = read_u32(&mut reader)?;
        if magic != GGUF_MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Not a GGUF file (magic: 0x{:08X}, expected 0x{:08X})", magic, GGUF_MAGIC),
            ));
        }

        let version = read_u32(&mut reader)?;
        if version > 3 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Unsupported GGUF version: {} (supported: 1, 2, 3)", version),
            ));
        }

        // v1 uses u32 for counts, v2/v3 use u64
        let (tensor_count, metadata_kv_count) = if version == 1 {
            (read_u32(&mut reader)? as usize, read_u32(&mut reader)? as usize)
        } else {
            (read_u64(&mut reader)? as usize, read_u64(&mut reader)? as usize)
        };

        // Read metadata key-value pairs
        let mut metadata = HashMap::new();
        for _ in 0..metadata_kv_count {
            let key = if version == 1 {
                read_gguf_string_v1(&mut reader)?
            } else {
                read_gguf_string(&mut reader)?
            };
            let value_type = GgufValueType::from_u32(read_u32(&mut reader)?).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "Unknown metadata value type")
            })?;
            let value = read_metadata_value(&mut reader, value_type, version)?;
            metadata.insert(key, value);
        }

        // Read tensor infos
        let mut tensor_infos = Vec::with_capacity(tensor_count);
        for _ in 0..tensor_count {
            let name = if version == 1 {
                read_gguf_string_v1(&mut reader)?
            } else {
                read_gguf_string(&mut reader)?
            };
            let n_dims = read_u32(&mut reader)? as usize;
            let mut shape = Vec::with_capacity(n_dims);
            for _ in 0..n_dims {
                if version == 1 {
                    shape.push(read_u32(&mut reader)? as usize);
                } else {
                    shape.push(read_u64(&mut reader)? as usize);
                }
            }
            let dtype = GgmlDtype::from_u32(read_u32(&mut reader)?);
            let offset = read_u64(&mut reader)?;
            tensor_infos.push(TensorInfo {
                name,
                shape,
                dtype,
                offset,
            });
        }

        // Data starts at the next aligned position (32-byte alignment)
        let current_pos = reader.stream_position()?;
        let alignment = metadata
            .get("general.alignment")
            .and_then(|v| v.as_u32())
            .unwrap_or(32) as u64;
        let data_offset = (current_pos + alignment - 1) / alignment * alignment;

        Ok(GgufFile {
            version,
            metadata,
            tensor_infos,
            data_offset,
            reader,
        })
    }

    /// Get a summary of the model.
    pub fn summary(&self) -> String {
        let arch = self
            .metadata
            .get("general.architecture")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let name = self
            .metadata
            .get("general.name")
            .and_then(|v| v.as_str())
            .unwrap_or("unnamed");

        format!(
            "GGUF v{}: '{}' ({})\n  {} tensors, {} metadata keys",
            self.version,
            name,
            arch,
            self.tensor_infos.len(),
            self.metadata.len(),
        )
    }

    /// List all tensor names with shapes and dtypes.
    pub fn list_tensors(&self) -> Vec<String> {
        self.tensor_infos
            .iter()
            .map(|t| format!("{}: shape={:?}, dtype={:?}", t.name, t.shape, t.dtype))
            .collect()
    }

    /// Find a tensor by name.
    pub fn find_tensor(&self, name: &str) -> Option<&TensorInfo> {
        self.tensor_infos.iter().find(|t| t.name == name)
    }

    /// Load a tensor's data as our `Tensor` type.
    /// Currently supports F32 and F16 (converted to F32).
    pub fn load_tensor(&mut self, name: &str) -> io::Result<Tensor> {
        let info = self
            .tensor_infos
            .iter()
            .find(|t| t.name == name)
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("Tensor '{}' not found", name),
                )
            })?
            .clone();

        let abs_offset = self.data_offset + info.offset;
        self.reader.seek(SeekFrom::Start(abs_offset))?;

        let num_elements = info.num_elements();

        let data = match info.dtype {
            GgmlDtype::F32 => {
                let mut buf = vec![0u8; num_elements * 4];
                self.reader.read_exact(&mut buf)?;
                buf.chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect()
            }
            GgmlDtype::F16 => {
                let mut buf = vec![0u8; num_elements * 2];
                self.reader.read_exact(&mut buf)?;
                buf.chunks_exact(2)
                    .map(|c| f16_to_f32(u16::from_le_bytes([c[0], c[1]])))
                    .collect()
            }
            other => {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    format!(
                        "Tensor '{}' has dtype {:?} — only F32 and F16 are currently supported",
                        name, other
                    ),
                ));
            }
        };

        // GGUF stores shapes in column-major order (like GGML),
        // but we use row-major. Reverse the shape.
        let shape: Vec<usize> = info.shape.iter().rev().copied().collect();

        Ok(Tensor::new(data, shape))
    }

    /// Load all F32/F16 tensors into a HashMap.
    pub fn load_all_tensors(&mut self) -> io::Result<HashMap<String, Tensor>> {
        let names: Vec<String> = self
            .tensor_infos
            .iter()
            .filter(|t| matches!(t.dtype, GgmlDtype::F32 | GgmlDtype::F16))
            .map(|t| t.name.clone())
            .collect();

        let mut tensors = HashMap::new();
        for name in names {
            let tensor = self.load_tensor(&name)?;
            tensors.insert(name, tensor);
        }
        Ok(tensors)
    }
}

// ── Helpers ──────────────────────────────────────────────────────

fn read_u8<R: Read>(r: &mut R) -> io::Result<u8> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf)?;
    Ok(buf[0])
}

fn read_i8<R: Read>(r: &mut R) -> io::Result<i8> {
    Ok(read_u8(r)? as i8)
}

fn read_u16<R: Read>(r: &mut R) -> io::Result<u16> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf)?;
    Ok(u16::from_le_bytes(buf))
}

fn read_i16<R: Read>(r: &mut R) -> io::Result<i16> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf)?;
    Ok(i16::from_le_bytes(buf))
}

fn read_u32<R: Read>(r: &mut R) -> io::Result<u32> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_i32<R: Read>(r: &mut R) -> io::Result<i32> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf)?;
    Ok(i32::from_le_bytes(buf))
}

fn read_u64<R: Read>(r: &mut R) -> io::Result<u64> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf)?;
    Ok(u64::from_le_bytes(buf))
}

fn read_i64<R: Read>(r: &mut R) -> io::Result<i64> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf)?;
    Ok(i64::from_le_bytes(buf))
}

fn read_f32<R: Read>(r: &mut R) -> io::Result<f32> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf)?;
    Ok(f32::from_le_bytes(buf))
}

fn read_f64<R: Read>(r: &mut R) -> io::Result<f64> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf)?;
    Ok(f64::from_le_bytes(buf))
}

/// Read a GGUF string (v2/v3): u64 length followed by UTF-8 bytes.
fn read_gguf_string<R: Read>(r: &mut R) -> io::Result<String> {
    let len = read_u64(r)? as usize;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("Invalid UTF-8: {}", e)))
}

/// Read a GGUF string (v1): u32 length followed by UTF-8 bytes.
fn read_gguf_string_v1<R: Read>(r: &mut R) -> io::Result<String> {
    let len = read_u32(r)? as usize;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("Invalid UTF-8: {}", e)))
}

/// Read a metadata value of the given type.
fn read_metadata_value<R: Read>(r: &mut R, vtype: GgufValueType, version: u32) -> io::Result<MetadataValue> {
    match vtype {
        GgufValueType::Uint8 => Ok(MetadataValue::Uint8(read_u8(r)?)),
        GgufValueType::Int8 => Ok(MetadataValue::Int8(read_i8(r)?)),
        GgufValueType::Uint16 => Ok(MetadataValue::Uint16(read_u16(r)?)),
        GgufValueType::Int16 => Ok(MetadataValue::Int16(read_i16(r)?)),
        GgufValueType::Uint32 => Ok(MetadataValue::Uint32(read_u32(r)?)),
        GgufValueType::Int32 => Ok(MetadataValue::Int32(read_i32(r)?)),
        GgufValueType::Float32 => Ok(MetadataValue::Float32(read_f32(r)?)),
        GgufValueType::Bool => Ok(MetadataValue::Bool(read_u8(r)? != 0)),
        GgufValueType::String => {
            let s = if version == 1 { read_gguf_string_v1(r)? } else { read_gguf_string(r)? };
            Ok(MetadataValue::String(s))
        }
        GgufValueType::Array => {
            let elem_type =
                GgufValueType::from_u32(read_u32(r)?).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Unknown array element type")
                })?;
            let count = if version == 1 { read_u32(r)? as usize } else { read_u64(r)? as usize };
            let mut values = Vec::with_capacity(count);
            for _ in 0..count {
                values.push(read_metadata_value(r, elem_type, version)?);
            }
            Ok(MetadataValue::Array(values))
        }
        GgufValueType::Uint64 => Ok(MetadataValue::Uint64(read_u64(r)?)),
        GgufValueType::Int64 => Ok(MetadataValue::Int64(read_i64(r)?)),
        GgufValueType::Float64 => Ok(MetadataValue::Float64(read_f64(r)?)),
    }
}

/// Convert an IEEE 754 half-precision float (u16) to f32.
fn f16_to_f32(half: u16) -> f32 {
    let sign = ((half >> 15) & 1) as u32;
    let exponent = ((half >> 10) & 0x1F) as u32;
    let mantissa = (half & 0x3FF) as u32;

    if exponent == 0 {
        if mantissa == 0 {
            // Zero
            f32::from_bits(sign << 31)
        } else {
            // Subnormal: normalize
            let mut e = exponent;
            let mut m = mantissa;
            while (m & 0x400) == 0 {
                m <<= 1;
                e = e.wrapping_sub(1);
            }
            e = e.wrapping_add(1);
            m &= 0x3FF;
            let f32_exp = (127 - 15 + e) & 0xFF;
            f32::from_bits((sign << 31) | (f32_exp << 23) | (m << 13))
        }
    } else if exponent == 31 {
        // Inf or NaN
        if mantissa == 0 {
            f32::from_bits((sign << 31) | (0xFF << 23))
        } else {
            f32::from_bits((sign << 31) | (0xFF << 23) | (mantissa << 13))
        }
    } else {
        // Normal
        let f32_exp = (127 - 15 + exponent) & 0xFF;
        f32::from_bits((sign << 31) | (f32_exp << 23) | (mantissa << 13))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Build a minimal valid GGUF file in memory for testing.
    fn make_test_gguf() -> Vec<u8> {
        let mut buf = Vec::new();

        // Magic
        buf.extend_from_slice(&GGUF_MAGIC.to_le_bytes());
        // Version 3
        buf.extend_from_slice(&3u32.to_le_bytes());
        // Tensor count: 1
        buf.extend_from_slice(&1u64.to_le_bytes());
        // Metadata KV count: 2
        buf.extend_from_slice(&2u64.to_le_bytes());

        // Metadata key 1: "general.architecture" = "test"
        write_gguf_string(&mut buf, "general.architecture");
        buf.extend_from_slice(&(GgufValueType::String as u32).to_le_bytes());
        write_gguf_string(&mut buf, "test");

        // Metadata key 2: "general.name" = "tiny-test"
        write_gguf_string(&mut buf, "general.name");
        buf.extend_from_slice(&(GgufValueType::String as u32).to_le_bytes());
        write_gguf_string(&mut buf, "tiny-test");

        // Tensor info: "weight" with shape [2, 3], F32, offset 0
        write_gguf_string(&mut buf, "weight");
        buf.extend_from_slice(&2u32.to_le_bytes()); // n_dims
        buf.extend_from_slice(&3u64.to_le_bytes()); // dim 0 (GGUF order: col-major)
        buf.extend_from_slice(&2u64.to_le_bytes()); // dim 1
        buf.extend_from_slice(&0u32.to_le_bytes()); // dtype = F32
        buf.extend_from_slice(&0u64.to_le_bytes()); // offset = 0

        // Pad to 32-byte alignment
        let current_len = buf.len();
        let aligned = (current_len + 31) / 32 * 32;
        buf.resize(aligned, 0);

        // Tensor data: 6 f32 values [1, 2, 3, 4, 5, 6]
        for v in [1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0] {
            buf.extend_from_slice(&v.to_le_bytes());
        }

        buf
    }

    fn write_gguf_string(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(&(s.len() as u64).to_le_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    #[test]
    fn test_parse_gguf() {
        let data = make_test_gguf();
        let cursor = Cursor::new(data);
        let file = GgufFile::parse(cursor).unwrap();

        assert_eq!(file.version, 3);
        assert_eq!(file.metadata.len(), 2);
        assert_eq!(
            file.metadata
                .get("general.architecture")
                .unwrap()
                .as_str()
                .unwrap(),
            "test"
        );
        assert_eq!(
            file.metadata
                .get("general.name")
                .unwrap()
                .as_str()
                .unwrap(),
            "tiny-test"
        );
        assert_eq!(file.tensor_infos.len(), 1);
        assert_eq!(file.tensor_infos[0].name, "weight");
        assert_eq!(file.tensor_infos[0].dtype, GgmlDtype::F32);
    }

    #[test]
    fn test_load_tensor() {
        let data = make_test_gguf();
        let cursor = Cursor::new(data);
        let mut file = GgufFile::parse(cursor).unwrap();

        let tensor = file.load_tensor("weight").unwrap();
        // GGUF shape [3, 2] reversed to row-major [2, 3]
        assert_eq!(tensor.shape, vec![2, 3]);
        assert_eq!(tensor.data, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn test_summary() {
        let data = make_test_gguf();
        let cursor = Cursor::new(data);
        let file = GgufFile::parse(cursor).unwrap();
        let summary = file.summary();
        assert!(summary.contains("tiny-test"));
        assert!(summary.contains("test"));
        assert!(summary.contains("1 tensors"));
    }

    #[test]
    fn test_f16_conversion() {
        // 0 -> 0.0
        assert_eq!(f16_to_f32(0x0000), 0.0);
        // 1.0 in f16 = 0x3C00
        assert!((f16_to_f32(0x3C00) - 1.0).abs() < 1e-6);
        // -1.0 in f16 = 0xBC00
        assert!((f16_to_f32(0xBC00) - (-1.0)).abs() < 1e-6);
        // 0.5 in f16 = 0x3800
        assert!((f16_to_f32(0x3800) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_tensor_not_found() {
        let data = make_test_gguf();
        let cursor = Cursor::new(data);
        let mut file = GgufFile::parse(cursor).unwrap();
        assert!(file.load_tensor("nonexistent").is_err());
    }
}
