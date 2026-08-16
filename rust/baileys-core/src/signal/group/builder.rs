use super::message::SenderKeyDistributionMessage;
use super::record::SenderKeyRecord;
use rand::Rng;
use x25519_dalek::{PublicKey, StaticSecret};

pub struct GroupSessionBuilder;

impl GroupSessionBuilder {
    /// Ingests an incoming SKDM into the SenderKeyRecord
    pub fn process(
        record: &mut SenderKeyRecord,
        distribution_message: &SenderKeyDistributionMessage,
    ) {
        record.add_sender_key_state(
            distribution_message.id(),
            distribution_message.iteration(),
            distribution_message.chain_key(),
            distribution_message.signature_key(),
        );
    }

    /// Generates initial SenderKey state if record is empty, and returns the serialized SKDM
    pub fn create(
        record: &mut SenderKeyRecord,
    ) -> Result<SenderKeyDistributionMessage, String> {
        if record.is_empty() {
            let mut rng = rand::thread_rng();
            let key_id: u32 = rng.gen_range(1..=2147483647);

            let mut sender_key = [0u8; 32];
            rng.fill(&mut sender_key);

            let mut signing_priv = [0u8; 32];
            rng.fill(&mut signing_priv);
            signing_priv[0] &= 248;
            signing_priv[31] &= 127;
            signing_priv[31] |= 64;

            let secret = StaticSecret::from(signing_priv);
            let public_key = PublicKey::from(&secret);
            let raw_pub = public_key.as_bytes();

            let mut signing_pub = Vec::with_capacity(33);
            signing_pub.push(0x05);
            signing_pub.extend_from_slice(raw_pub);

            record.set_sender_key_state(
                key_id,
                0,
                &sender_key,
                &signing_pub,
                Some(&signing_priv),
            );
        }

        let state = record
            .get_sender_key_state(None)
            .ok_or_else(|| "No session state available".to_string())?;

        let chain_key = state.get_sender_chain_key();
        let pub_key = state.get_signing_key_public();

        SenderKeyDistributionMessage::new(
            state.key_id(),
            chain_key.iteration(),
            chain_key.seed(),
            &pub_key,
        )
    }
}
