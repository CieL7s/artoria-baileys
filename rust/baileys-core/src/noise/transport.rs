use crate::noise::crypto::{aes_gcm_decrypt, aes_gcm_encrypt, generate_iv, CryptoError};

#[derive(Debug, Clone)]
pub struct TransportState {
    enc_key: [u8; 32],
    dec_key: [u8; 32],
    read_counter: u32,
    write_counter: u32,
}

impl TransportState {
    pub fn new(enc_key: [u8; 32], dec_key: [u8; 32]) -> Self {
        Self {
            enc_key,
            dec_key,
            read_counter: 0,
            write_counter: 0,
        }
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let counter = self.write_counter;
        self.write_counter += 1;
        let iv = generate_iv(counter);
        aes_gcm_encrypt(&self.enc_key, &iv, &[], plaintext)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let counter = self.read_counter;
        self.read_counter += 1;
        let iv = generate_iv(counter);
        aes_gcm_decrypt(&self.dec_key, &iv, &[], ciphertext)
    }

    pub fn get_read_counter(&self) -> u32 {
        self.read_counter
    }

    pub fn get_write_counter(&self) -> u32 {
        self.write_counter
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transport_roundtrip_counters() {
        let enc_key = [0x11u8; 32];
        let dec_key = [0x22u8; 32];

        // Sender uses (enc_key, dec_key)
        let mut sender = TransportState::new(enc_key, dec_key);
        // Receiver uses (dec_key, enc_key) -> receiver's dec_key is sender's enc_key
        let mut receiver = TransportState::new(dec_key, enc_key);

        let msg1 = b"First frame";
        let msg2 = b"Second frame";

        let cipher1 = sender.encrypt(msg1).expect("send 1 failed");
        let cipher2 = sender.encrypt(msg2).expect("send 2 failed");

        assert_eq!(sender.get_write_counter(), 2);

        let plain1 = receiver.decrypt(&cipher1).expect("recv 1 failed");
        let plain2 = receiver.decrypt(&cipher2).expect("recv 2 failed");

        assert_eq!(receiver.get_read_counter(), 2);
        assert_eq!(plain1, msg1);
        assert_eq!(plain2, msg2);
    }
}
