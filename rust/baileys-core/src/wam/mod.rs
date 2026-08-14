pub struct WamEncoder;

impl WamEncoder {
    pub const WAM_HEADER: &'static [u8] = b"WAM\x01\x01";

    pub fn encode_event(event_id: u32, weight: f32) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(Self::WAM_HEADER);
        buf.extend_from_slice(&event_id.to_be_bytes());
        buf.extend_from_slice(&weight.to_be_bytes());
        buf
    }
}
