pub fn encode_frame(payload: &[u8], intro_header: Option<&[u8]>) -> Vec<u8> {
    let payload_len = payload.len();
    let intro_len = intro_header.map(|h| h.len()).unwrap_or(0);
    let mut frame = Vec::with_capacity(intro_len + 3 + payload_len);

    if let Some(intro) = intro_header {
        frame.extend_from_slice(intro);
    }

    frame.push(((payload_len >> 16) & 0xff) as u8);
    frame.push(((payload_len >> 8) & 0xff) as u8);
    frame.push((payload_len & 0xff) as u8);
    frame.extend_from_slice(payload);

    frame
}

#[derive(Default, Debug)]
pub struct FrameBuffer {
    buffer: Vec<u8>,
}

impl FrameBuffer {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push_data(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    pub fn pop_frame(&mut self) -> Option<Vec<u8>> {
        if self.buffer.len() < 3 {
            return None;
        }

        let size = ((self.buffer[0] as usize) << 16)
            | ((self.buffer[1] as usize) << 8)
            | (self.buffer[2] as usize);

        if self.buffer.len() < size + 3 {
            return None;
        }

        let frame = self.buffer[3..size + 3].to_vec();
        self.buffer.drain(0..size + 3);
        Some(frame)
    }

    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_framing_encode_and_buffer_pop() {
        let payload1 = b"whatsapp packet 1";
        let payload2 = b"whatsapp packet 2";

        let frame1 = encode_frame(payload1, Some(b"WA\x06\x02"));
        let frame2 = encode_frame(payload2, None);

        let mut fb = FrameBuffer::new();

        // First frame has intro header "WA\x06\x02" (4 bytes)
        // Strip intro header when feeding into frame parser after initial handshake
        fb.push_data(&frame1[4..]);
        fb.push_data(&frame2);

        let popped1 = fb.pop_frame().expect("should pop 1");
        assert_eq!(popped1, payload1);

        let popped2 = fb.pop_frame().expect("should pop 2");
        assert_eq!(popped2, payload2);

        assert!(fb.pop_frame().is_none());
    }
}
