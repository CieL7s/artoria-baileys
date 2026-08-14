use aes::cipher::{BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes256;
use hmac::{Hmac, Mac};
use rand::{thread_rng, RngCore};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::noise::crypto::hkdf_sha256;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum MediaError {
    #[error("Invalid media buffer length")]
    InvalidBufferLength,
    #[error("MAC validation failed: media buffer is corrupted or tampered")]
    MacMismatch,
    #[error("Invalid PKCS7 padding")]
    InvalidPadding,
    #[error("Crypto error: {0}")]
    CryptoError(String),
}

pub enum MediaType {
    Image,
    Video,
    Audio,
    Document,
    Sticker,
}

impl MediaType {
    pub fn app_info(&self) -> &'static [u8] {
        match self {
            MediaType::Image => b"WhatsApp Image Keys",
            MediaType::Video => b"WhatsApp Video Keys",
            MediaType::Audio => b"WhatsApp Audio Keys",
            MediaType::Document => b"WhatsApp Document Keys",
            MediaType::Sticker => b"WhatsApp Image Keys",
        }
    }
}

pub struct MediaKeys {
    pub iv: [u8; 16],
    pub cipher_key: [u8; 32],
    pub mac_key: [u8; 32],
    pub ref_key: [u8; 32],
}

pub fn derive_media_keys(media_key: &[u8; 32], media_type: &MediaType) -> Result<MediaKeys, MediaError> {
    let expanded = hkdf_sha256(&[], media_key, media_type.app_info(), 112)
        .map_err(|e| MediaError::CryptoError(e.to_string()))?;

    let mut iv = [0u8; 16];
    let mut cipher_key = [0u8; 32];
    let mut mac_key = [0u8; 32];
    let mut ref_key = [0u8; 32];

    iv.copy_from_slice(&expanded[0..16]);
    cipher_key.copy_from_slice(&expanded[16..48]);
    mac_key.copy_from_slice(&expanded[48..80]);
    ref_key.copy_from_slice(&expanded[80..112]);

    Ok(MediaKeys {
        iv,
        cipher_key,
        mac_key,
        ref_key,
    })
}

/// AES-256-CBC Decryption with PKCS7 unpadding
pub fn aes_cbc_decrypt(key: &[u8; 32], iv: &[u8; 16], ciphertext: &[u8]) -> Result<Vec<u8>, MediaError> {
    if ciphertext.len() % 16 != 0 || ciphertext.is_empty() {
        return Err(MediaError::InvalidBufferLength);
    }

    let cipher = Aes256::new_from_slice(key).map_err(|e| MediaError::CryptoError(e.to_string()))?;
    let mut plaintext = vec![0u8; ciphertext.len()];
    let mut prev_block = iv;

    for (chunk_in, chunk_out) in ciphertext.chunks_exact(16).zip(plaintext.chunks_exact_mut(16)) {
        let mut block = aes::Block::clone_from_slice(chunk_in);
        cipher.decrypt_block(&mut block);

        for i in 0..16 {
            chunk_out[i] = block[i] ^ prev_block[i];
        }
        prev_block = chunk_in.try_into().unwrap();
    }

    // PKCS7 unpadding
    let pad_len = *plaintext.last().ok_or(MediaError::InvalidPadding)? as usize;
    if pad_len == 0 || pad_len > 16 || pad_len > plaintext.len() {
        return Err(MediaError::InvalidPadding);
    }

    for &b in &plaintext[plaintext.len() - pad_len..] {
        if b as usize != pad_len {
            return Err(MediaError::InvalidPadding);
        }
    }

    plaintext.truncate(plaintext.len() - pad_len);
    Ok(plaintext)
}

/// AES-256-CBC Encryption with PKCS7 padding
pub fn aes_cbc_encrypt(key: &[u8; 32], iv: &[u8; 16], plaintext: &[u8]) -> Result<Vec<u8>, MediaError> {
    let cipher = Aes256::new_from_slice(key).map_err(|e| MediaError::CryptoError(e.to_string()))?;
    
    // PKCS7 padding
    let pad_len = 16 - (plaintext.len() % 16);
    let mut padded = Vec::with_capacity(plaintext.len() + pad_len);
    padded.extend_from_slice(plaintext);
    padded.resize(plaintext.len() + pad_len, pad_len as u8);

    let mut ciphertext = vec![0u8; padded.len()];
    let mut prev_block = *iv;

    for (chunk_in, chunk_out) in padded.chunks_exact(16).zip(ciphertext.chunks_exact_mut(16)) {
        let mut block = aes::Block::default();
        for i in 0..16 {
            block[i] = chunk_in[i] ^ prev_block[i];
        }
        cipher.encrypt_block(&mut block);
        chunk_out.copy_from_slice(&block);
        prev_block.copy_from_slice(&block);
    }

    Ok(ciphertext)
}

pub fn decrypt_media(
    encrypted_buffer: &[u8],
    media_key: &[u8; 32],
    media_type: MediaType,
) -> Result<Vec<u8>, MediaError> {
    if encrypted_buffer.len() < 10 {
        return Err(MediaError::InvalidBufferLength);
    }

    let keys = derive_media_keys(media_key, &media_type)?;
    let cipher_len = encrypted_buffer.len() - 10;
    let ciphertext = &encrypted_buffer[..cipher_len];
    let mac = &encrypted_buffer[cipher_len..];

    // Verify HMAC-SHA256 of IV || Ciphertext
    let mut hmac = <Hmac<Sha256> as Mac>::new_from_slice(&keys.mac_key)
        .map_err(|e| MediaError::CryptoError(e.to_string()))?;
    hmac.update(&keys.iv);
    hmac.update(ciphertext);
    let full_mac = hmac.finalize().into_bytes();

    if &full_mac[..10] != mac {
        return Err(MediaError::MacMismatch);
    }

    aes_cbc_decrypt(&keys.cipher_key, &keys.iv, ciphertext)
}

pub struct EncryptedMediaResult {
    pub encrypted_buffer: Vec<u8>,
    pub media_key: [u8; 32],
    pub file_sha256: [u8; 32],
    pub file_enc_sha256: [u8; 32],
}

pub fn encrypt_media(
    plaintext: &[u8],
    media_type: MediaType,
) -> Result<EncryptedMediaResult, MediaError> {
    let mut rng = thread_rng();
    let mut media_key = [0u8; 32];
    rng.fill_bytes(&mut media_key);

    let keys = derive_media_keys(&media_key, &media_type)?;
    let ciphertext = aes_cbc_encrypt(&keys.cipher_key, &keys.iv, plaintext)?;

    let mut hmac = <Hmac<Sha256> as Mac>::new_from_slice(&keys.mac_key)
        .map_err(|e| MediaError::CryptoError(e.to_string()))?;
    hmac.update(&keys.iv);
    hmac.update(&ciphertext);
    let full_mac = hmac.finalize().into_bytes();

    let mut encrypted_buffer = Vec::with_capacity(ciphertext.len() + 10);
    encrypted_buffer.extend_from_slice(&ciphertext);
    encrypted_buffer.extend_from_slice(&full_mac[..10]);

    let mut hasher = Sha256::new();
    hasher.update(plaintext);
    let file_sha256 = hasher.finalize().into();

    let mut enc_hasher = Sha256::new();
    enc_hasher.update(&encrypted_buffer);
    let file_enc_sha256 = enc_hasher.finalize().into();

    Ok(EncryptedMediaResult {
        encrypted_buffer,
        media_key,
        file_sha256,
        file_enc_sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_encrypt_decrypt_roundtrip() {
        let original_image = b"RIEL_BAILEYS_IMAGE_DATA_1234567890_JPEG_PNG";
        let encrypted = encrypt_media(original_image, MediaType::Image).expect("encrypt media");

        assert_ne!(&encrypted.encrypted_buffer[..], &original_image[..]);

        let decrypted = decrypt_media(
            &encrypted.encrypted_buffer,
            &encrypted.media_key,
            MediaType::Image,
        )
        .expect("decrypt media");

        assert_eq!(&decrypted[..], &original_image[..]);
    }
}
