use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Error, Debug, PartialEq, Eq)]
pub enum CryptoError {
    #[error("AES-GCM encryption error")]
    EncryptionError,
    #[error("AES-GCM decryption error / authentication failed")]
    DecryptionError,
    #[error("Invalid key length: expected 32 bytes")]
    InvalidKeyLength,
    #[error("HKDF expansion error")]
    HkdfError,
}

pub fn generate_iv(counter: u32) -> [u8; 12] {
    let mut iv = [0u8; 12];
    iv[8] = ((counter >> 24) & 0xff) as u8;
    iv[9] = ((counter >> 16) & 0xff) as u8;
    iv[10] = ((counter >> 8) & 0xff) as u8;
    iv[11] = (counter & 0xff) as u8;
    iv
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn hkdf_sha256(salt: &[u8], ikm: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, CryptoError> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut okm = vec![0u8; length];
    hk.expand(info, &mut okm).map_err(|_| CryptoError::HkdfError)?;
    Ok(okm)
}

pub fn aes_gcm_encrypt(
    key: &[u8],
    iv: &[u8; 12],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::InvalidKeyLength)?;
    let nonce = Nonce::from_slice(iv);
    let payload = Payload {
        msg: plaintext,
        aad,
    };
    cipher.encrypt(nonce, payload).map_err(|_| CryptoError::EncryptionError)
}

pub fn aes_gcm_decrypt(
    key: &[u8],
    iv: &[u8; 12],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::InvalidKeyLength)?;
    let nonce = Nonce::from_slice(iv);
    let payload = Payload {
        msg: ciphertext,
        aad,
    };
    cipher.decrypt(nonce, payload).map_err(|_| CryptoError::DecryptionError)
}

pub fn curve25519_shared_key(private_key: &[u8; 32], public_key: &[u8; 32]) -> [u8; 32] {
    let secret = StaticSecret::from(*private_key);
    let public = PublicKey::from(*public_key);
    secret.diffie_hellman(&public).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = [0x42u8; 32];
        let iv = generate_iv(1);
        let aad = b"header-aad";
        let plaintext = b"Hello WhatsApp Noise Protocol!";

        let ciphertext = aes_gcm_encrypt(&key, &iv, aad, plaintext).expect("encrypt failed");
        let decrypted = aes_gcm_decrypt(&key, &iv, aad, &ciphertext).expect("decrypt failed");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_generate_iv_counter() {
        let iv = generate_iv(0x01020304);
        assert_eq!(iv[8], 0x01);
        assert_eq!(iv[9], 0x02);
        assert_eq!(iv[10], 0x03);
        assert_eq!(iv[11], 0x04);
    }
}
