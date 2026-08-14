use std::collections::HashMap;
use std::sync::OnceLock;
use crate::protocol::constants::{Tags, DOUBLE_BYTE_TOKENS, SINGLE_BYTE_TOKENS};
use crate::protocol::jid::{jid_decode, FullJid};
use crate::protocol::node::{BinaryNode, BinaryNodeContent, ProtocolError};

#[derive(Clone, Copy)]
pub struct TokenPos {
    pub dict: Option<u8>,
    pub index: u8,
}

static TOKEN_MAP: OnceLock<HashMap<&'static str, TokenPos>> = OnceLock::new();

fn get_token_map() -> &'static HashMap<&'static str, TokenPos> {
    TOKEN_MAP.get_or_init(|| {
        let mut map = HashMap::with_capacity(1500);
        for (i, &token) in SINGLE_BYTE_TOKENS.iter().enumerate() {
            if !token.is_empty() {
                map.insert(token, TokenPos { dict: None, index: i as u8 });
            }
        }
        for (dict_idx, dict) in DOUBLE_BYTE_TOKENS.iter().enumerate() {
            for (token_idx, &token) in dict.iter().enumerate() {
                map.insert(token, TokenPos {
                    dict: Some(dict_idx as u8),
                    index: token_idx as u8,
                });
            }
        }
        map
    })
}

pub struct Encoder {
    buffer: Vec<u8>,
}

impl Encoder {
    pub fn new() -> Self {
        Self {
            buffer: vec![0], // 0x00 prefix for uncompressed node
        }
    }

    fn push_byte(&mut self, val: u8) {
        self.buffer.push(val);
    }

    fn push_bytes(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    fn push_int(&mut self, val: usize, n: usize, little_endian: bool) {
        for i in 0..n {
            let shift = if little_endian { i } else { n - 1 - i };
            self.buffer.push(((val >> (shift * 8)) & 0xff) as u8);
        }
    }

    fn push_int16(&mut self, val: usize) {
        self.push_bytes(&[((val >> 8) & 0xff) as u8, (val & 0xff) as u8]);
    }

    fn push_int20(&mut self, val: usize) {
        self.push_bytes(&[
            ((val >> 16) & 0x0f) as u8,
            ((val >> 8) & 0xff) as u8,
            (val & 0xff) as u8,
        ]);
    }

    fn write_byte_length(&mut self, length: usize) -> Result<(), ProtocolError> {
        if length >= (1 << 32) {
            return Err(ProtocolError::StringTooLarge(length));
        }

        if length >= (1 << 20) {
            self.push_byte(Tags::BINARY_32);
            self.push_int(length, 4, false);
        } else if length >= 256 {
            self.push_byte(Tags::BINARY_20);
            self.push_int20(length);
        } else {
            self.push_byte(Tags::BINARY_8);
            self.push_byte(length as u8);
        }
        Ok(())
    }

    fn write_string_raw(&mut self, s: &str) -> Result<(), ProtocolError> {
        let bytes = s.as_bytes();
        self.write_byte_length(bytes.len())?;
        self.push_bytes(bytes);
        Ok(())
    }

    fn write_jid(&mut self, jid: &FullJid) -> Result<(), ProtocolError> {
        if let Some(device) = jid.device {
            self.push_byte(Tags::AD_JID);
            self.push_byte(jid.domain_type.unwrap_or(0));
            self.push_byte(device);
            self.write_string(&jid.user)?;
        } else {
            self.push_byte(Tags::JID_PAIR);
            if !jid.user.is_empty() {
                self.write_string(&jid.user)?;
            } else {
                self.push_byte(Tags::LIST_EMPTY);
            }
            self.write_string(&jid.server)?;
        }
        Ok(())
    }

    fn pack_nibble(c: char) -> Result<u8, ProtocolError> {
        match c {
            '-' => Ok(10),
            '.' => Ok(11),
            '\0' => Ok(15),
            '0'..='9' => Ok((c as u8) - b'0'),
            _ => Err(ProtocolError::InvalidNibble(c as u8)),
        }
    }

    fn pack_hex(c: char) -> Result<u8, ProtocolError> {
        match c {
            '0'..='9' => Ok((c as u8) - b'0'),
            'A'..='F' => Ok(10 + (c as u8) - b'A'),
            'a'..='f' => Ok(10 + (c as u8) - b'a'),
            '\0' => Ok(15),
            _ => Err(ProtocolError::InvalidHex(c as u8)),
        }
    }

    fn write_packed_bytes(&mut self, s: &str, is_nibble: bool) -> Result<(), ProtocolError> {
        if s.len() > Tags::PACKED_MAX {
            return Err(ProtocolError::TooManyBytesToPack(s.len()));
        }

        self.push_byte(if is_nibble { Tags::NIBBLE_8 } else { Tags::HEX_8 });

        let mut rounded_len = (s.len() + 1) / 2;
        if s.len() % 2 != 0 {
            rounded_len |= 128;
        }
        self.push_byte(rounded_len as u8);

        let chars: Vec<char> = s.chars().collect();
        let half = s.len() / 2;
        for i in 0..half {
            let c1 = chars[2 * i];
            let c2 = chars[2 * i + 1];
            let byte = if is_nibble {
                (Self::pack_nibble(c1)? << 4) | Self::pack_nibble(c2)?
            } else {
                (Self::pack_hex(c1)? << 4) | Self::pack_hex(c2)?
            };
            self.push_byte(byte);
        }

        if s.len() % 2 != 0 {
            let last = chars[s.len() - 1];
            let byte = if is_nibble {
                (Self::pack_nibble(last)? << 4) | Self::pack_nibble('\0')?
            } else {
                (Self::pack_hex(last)? << 4) | Self::pack_hex('\0')?
            };
            self.push_byte(byte);
        }

        Ok(())
    }

    fn is_nibble(s: &str) -> bool {
        if s.is_empty() || s.len() > Tags::PACKED_MAX {
            return false;
        }
        s.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '.')
    }

    fn is_hex(s: &str) -> bool {
        if s.is_empty() || s.len() > Tags::PACKED_MAX {
            return false;
        }
        s.chars().all(|c| c.is_ascii_digit() || ('A'..='F').contains(&c))
    }

    pub fn write_string(&mut self, s: &str) -> Result<(), ProtocolError> {
        if s.is_empty() {
            return self.write_string_raw(s);
        }

        let token_map = get_token_map();
        if let Some(pos) = token_map.get(s) {
            if let Some(dict) = pos.dict {
                self.push_byte(Tags::DICTIONARY_0 + dict);
            }
            self.push_byte(pos.index);
        } else if Self::is_nibble(s) {
            self.write_packed_bytes(s, true)?;
        } else if Self::is_hex(s) {
            self.write_packed_bytes(s, false)?;
        } else if let Some(decoded_jid) = jid_decode(s) {
            self.write_jid(&decoded_jid)?;
        } else {
            self.write_string_raw(s)?;
        }
        Ok(())
    }

    fn write_list_start(&mut self, list_size: usize) {
        if list_size == 0 {
            self.push_byte(Tags::LIST_EMPTY);
        } else if list_size < 256 {
            self.push_bytes(&[Tags::LIST_8, list_size as u8]);
        } else {
            self.push_byte(Tags::LIST_16);
            self.push_int16(list_size);
        }
    }

    fn encode_node_inner(&mut self, node: &BinaryNode) -> Result<(), ProtocolError> {
        if node.tag.is_empty() {
            return Err(ProtocolError::InvalidNode("tag cannot be empty".to_string()));
        }

        let list_size = 2 * node.attrs.len() + 1 + if node.content.is_some() { 1 } else { 0 };
        self.write_list_start(list_size);
        self.write_string(&node.tag)?;

        for (k, v) in &node.attrs {
            self.write_string(k)?;
            self.write_string(v)?;
        }

        if let Some(content) = &node.content {
            match content {
                BinaryNodeContent::String(s) => {
                    self.write_string(s)?;
                }
                BinaryNodeContent::Bytes(bytes) => {
                    self.write_byte_length(bytes.len())?;
                    self.push_bytes(bytes);
                }
                BinaryNodeContent::NodeBuffer(buf_obj) => {
                    self.write_byte_length(buf_obj.data.len())?;
                    self.push_bytes(&buf_obj.data);
                }
                BinaryNodeContent::List(children) => {
                    self.write_list_start(children.len());
                    for child in children {
                        self.encode_node_inner(child)?;
                    }
                }
            }
        }

        Ok(())
    }

    pub fn finish(mut self, node: &BinaryNode) -> Result<Vec<u8>, ProtocolError> {
        self.encode_node_inner(node)?;
        Ok(self.buffer)
    }
}

pub fn encode_binary_node(node: &BinaryNode) -> Result<Vec<u8>, ProtocolError> {
    let encoder = Encoder::new();
    encoder.finish(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::decoder::decode_binary_node;

    #[test]
    fn test_node_encode_decode_roundtrip_simple() {
        let node = BinaryNode::new("iq")
            .with_attr("id", "12345")
            .with_attr("type", "get")
            .with_attr("to", "s.whatsapp.net")
            .with_string_content("ping");

        let encoded = encode_binary_node(&node).expect("encode failed");
        let decoded = decode_binary_node(&encoded).expect("decode failed");

        assert_eq!(decoded.tag, "iq");
        assert_eq!(decoded.get_attr("id"), Some("12345"));
        assert_eq!(decoded.get_attr("type"), Some("get"));
        assert_eq!(decoded.get_attr("to"), Some("s.whatsapp.net"));
        assert_eq!(decoded.content, Some(BinaryNodeContent::String("ping".to_string())));
    }

    #[test]
    fn test_node_encode_decode_roundtrip_nested_list() {
        let child1 = BinaryNode::new("item")
            .with_attr("id", "item-1")
            .with_bytes_content(vec![1, 2, 3, 4, 5]);

        let child2 = BinaryNode::new("item")
            .with_attr("id", "item-2")
            .with_string_content("hello world");

        let parent = BinaryNode::new("list")
            .with_attr("count", "2")
            .with_children(vec![child1, child2]);

        let encoded = encode_binary_node(&parent).expect("encode failed");
        let decoded = decode_binary_node(&encoded).expect("decode failed");

        assert_eq!(decoded.tag, "list");
        assert_eq!(decoded.get_attr("count"), Some("2"));

        let children = decoded.get_children("item");
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].get_attr("id"), Some("item-1"));
        assert_eq!(children[0].content, Some(BinaryNodeContent::Bytes(vec![1, 2, 3, 4, 5])));
        assert_eq!(children[1].get_attr("id"), Some("item-2"));
        assert_eq!(children[1].get_content_string(), Some("hello world".to_string()));
    }
}
