use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};

type HmacSha256 = Hmac<Sha256>;

fn calculate_mac(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    let result = mac.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result.into_bytes());
    out
}

fn derive_secrets(input: &[u8], salt: &[u8; 32], info: &[u8]) -> ([u8; 32], [u8; 32]) {
    let prk = calculate_mac(salt, input);
    
    // Chunk 1: HMAC(PRK, info || 0x01)
    let mut chunk1_input = Vec::with_capacity(info.len() + 1);
    chunk1_input.extend_from_slice(info);
    chunk1_input.push(1);
    let t1 = calculate_mac(&prk, &chunk1_input);

    // Chunk 2: HMAC(PRK, t1 || info || 0x02)
    let mut chunk2_input = Vec::with_capacity(32 + info.len() + 1);
    chunk2_input.extend_from_slice(&t1);
    chunk2_input.extend_from_slice(info);
    chunk2_input.push(2);
    let t2 = calculate_mac(&prk, &chunk2_input);

    (t1, t2)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderMessageKey {
    pub iteration: u32,
    pub iv: Vec<u8>,
    pub cipher_key: Vec<u8>,
    pub seed: Vec<u8>,
}

impl SenderMessageKey {
    pub fn new(iteration: u32, seed: &[u8]) -> Self {
        let salt = [0u8; 32];
        let (t1, t2) = derive_secrets(seed, &salt, b"WhisperGroup");
        
        let mut iv = Vec::with_capacity(16);
        iv.extend_from_slice(&t1[0..16]);

        let mut cipher_key = Vec::with_capacity(32);
        cipher_key.extend_from_slice(&t1[16..32]);
        cipher_key.extend_from_slice(&t2[0..16]);

        Self {
            iteration,
            iv,
            cipher_key,
            seed: seed.to_vec(),
        }
    }

    pub fn iteration(&self) -> u32 {
        self.iteration
    }

    pub fn iv(&self) -> &[u8] {
        &self.iv
    }

    pub fn cipher_key(&self) -> &[u8] {
        &self.cipher_key
    }

    pub fn seed(&self) -> &[u8] {
        &self.seed
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderChainKey {
    pub iteration: u32,
    pub seed: Vec<u8>,
}

impl SenderChainKey {
    pub fn new(iteration: u32, seed: &[u8]) -> Self {
        Self {
            iteration,
            seed: seed.to_vec(),
        }
    }

    pub fn iteration(&self) -> u32 {
        self.iteration
    }

    pub fn seed(&self) -> &[u8] {
        &self.seed
    }

    pub fn get_sender_message_key(&self) -> SenderMessageKey {
        let msg_seed = calculate_mac(&self.seed, &[0x01]);
        SenderMessageKey::new(self.iteration, &msg_seed)
    }

    pub fn get_next(&self) -> Self {
        let next_seed = calculate_mac(&self.seed, &[0x02]);
        Self {
            iteration: self.iteration + 1,
            seed: next_seed.to_vec(),
        }
    }
}
