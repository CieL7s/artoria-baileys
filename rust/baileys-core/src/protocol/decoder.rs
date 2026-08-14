use std::collections::HashMap;
use crate::protocol::constants::{Tags, DOUBLE_BYTE_TOKENS, SINGLE_BYTE_TOKENS};
use crate::protocol::jid::{jid_encode, domains};
use crate::protocol::node::{BinaryNode, BinaryNodeContent, ProtocolError};

pub struct Decoder<'a> {
    buffer: &'a [u8],
    index: usize,
}

impl<'a> Decoder<'a> {
    pub fn new(buffer: &'a [u8]) -> Self {
        Self { buffer, index: 0 }
    }

    fn check_eos(&self, length: usize) -> Result<(), ProtocolError> {
        if self.index + length > self.buffer.len() {
            Err(ProtocolError::EndOfStream)
        } else {
            Ok(())
        }
    }

    fn next_byte(&mut self) -> Result<u8, ProtocolError> {
        self.check_eos(1)?;
        let val = self.buffer[self.index];
        self.index += 1;
        Ok(val)
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], ProtocolError> {
        self.check_eos(n)?;
        let slice = &self.buffer[self.index..self.index + n];
        self.index += n;
        Ok(slice)
    }

    fn read_string_from_chars(&mut self, length: usize) -> Result<String, ProtocolError> {
        let bytes = self.read_bytes(length)?;
        String::from_utf8(bytes.to_vec())
            .map_err(|e| ProtocolError::Utf8Error(e.to_string()))
    }

    fn read_int(&mut self, n: usize, little_endian: bool) -> Result<usize, ProtocolError> {
        self.check_eos(n)?;
        let mut val: usize = 0;
        for i in 0..n {
            let shift = if little_endian { i } else { n - 1 - i };
            val |= (self.next_byte()? as usize) << (shift * 8);
        }
        Ok(val)
    }

    fn read_int20(&mut self) -> Result<usize, ProtocolError> {
        self.check_eos(3)?;
        let b0 = self.next_byte()? as usize;
        let b1 = self.next_byte()? as usize;
        let b2 = self.next_byte()? as usize;
        Ok(((b0 & 15) << 16) + (b1 << 8) + b2)
    }

    fn unpack_hex(value: u8) -> Result<u8, ProtocolError> {
        if value < 10 {
            Ok(b'0' + value)
        } else if value < 16 {
            Ok(b'A' + value - 10)
        } else {
            Err(ProtocolError::InvalidHex(value))
        }
    }

    fn unpack_nibble(value: u8) -> Result<u8, ProtocolError> {
        match value {
            0..=9 => Ok(b'0' + value),
            10 => Ok(b'-'),
            11 => Ok(b'.'),
            15 => Ok(0),
            _ => Err(ProtocolError::InvalidNibble(value)),
        }
    }

    fn unpack_byte(tag: u8, value: u8) -> Result<u8, ProtocolError> {
        if tag == Tags::NIBBLE_8 {
            Self::unpack_nibble(value)
        } else if tag == Tags::HEX_8 {
            Self::unpack_hex(value)
        } else {
            Err(ProtocolError::InvalidTag(tag))
        }
    }

    fn read_packed8(&mut self, tag: u8) -> Result<String, ProtocolError> {
        let start_byte = self.next_byte()?;
        let count = (start_byte & 127) as usize;
        let mut chars = Vec::with_capacity(count * 2);

        for _ in 0..count {
            let cur_byte = self.next_byte()?;
            let high = Self::unpack_byte(tag, (cur_byte & 0xf0) >> 4)?;
            chars.push(high);
            let low = Self::unpack_byte(tag, cur_byte & 0x0f)?;
            chars.push(low);
        }

        if (start_byte >> 7) != 0 && !chars.is_empty() {
            chars.pop();
        }

        String::from_utf8(chars).map_err(|e| ProtocolError::Utf8Error(e.to_string()))
    }

    fn is_list_tag(tag: u8) -> bool {
        tag == Tags::LIST_EMPTY || tag == Tags::LIST_8 || tag == Tags::LIST_16
    }

    fn read_list_size(&mut self, tag: u8) -> Result<usize, ProtocolError> {
        match tag {
            Tags::LIST_EMPTY => Ok(0),
            Tags::LIST_8 => Ok(self.next_byte()? as usize),
            Tags::LIST_16 => self.read_int(2, false),
            _ => Err(ProtocolError::InvalidTag(tag)),
        }
    }

    fn read_jid_pair(&mut self) -> Result<String, ProtocolError> {
        let tag_i = self.next_byte()?;
        let i = self.read_string(tag_i)?;
        let tag_j = self.next_byte()?;
        let j = self.read_string(tag_j)?;
        if !j.is_empty() {
            Ok(format!("{}@{}", i, j))
        } else {
            Err(ProtocolError::InvalidJidPair)
        }
    }

    fn read_ad_jid(&mut self) -> Result<String, ProtocolError> {
        let raw_domain_type = self.next_byte()?;
        let device = self.next_byte()?;
        let tag_user = self.next_byte()?;
        let user = self.read_string(tag_user)?;

        let server = match raw_domain_type {
            domains::LID => "lid",
            domains::HOSTED => "hosted",
            domains::HOSTED_LID => "hosted.lid",
            _ => "s.whatsapp.net",
        };

        Ok(jid_encode(&user, server, Some(device), None))
    }

    fn read_fb_jid(&mut self) -> Result<String, ProtocolError> {
        let tag_user = self.next_byte()?;
        let user = self.read_string(tag_user)?;
        let device = self.read_int(2, false)?;
        let tag_server = self.next_byte()?;
        let server = self.read_string(tag_server)?;
        Ok(format!("{}:{}@{}", user, device, server))
    }

    fn read_interop_jid(&mut self) -> Result<String, ProtocolError> {
        let tag_user = self.next_byte()?;
        let user = self.read_string(tag_user)?;
        let device = self.read_int(2, false)?;
        let integrator = self.read_int(2, false)?;

        let before_server = self.index;
        let server = match self.next_byte() {
            Ok(tag_server) => match self.read_string(tag_server) {
                Ok(s) => s,
                Err(_) => {
                    self.index = before_server;
                    "interop".to_string()
                }
            },
            Err(_) => {
                self.index = before_server;
                "interop".to_string()
            }
        };

        Ok(format!("{}-{}:{}@{}", integrator, user, device, server))
    }

    fn get_token_double(dict_idx: usize, token_idx: usize) -> Result<String, ProtocolError> {
        if dict_idx >= DOUBLE_BYTE_TOKENS.len() {
            return Err(ProtocolError::InvalidDoubleToken(dict_idx, token_idx));
        }
        let dict = DOUBLE_BYTE_TOKENS[dict_idx];
        if token_idx >= dict.len() {
            return Err(ProtocolError::InvalidDoubleToken(dict_idx, token_idx));
        }
        Ok(dict[token_idx].to_string())
    }

    pub fn read_string(&mut self, tag: u8) -> Result<String, ProtocolError> {
        if tag >= 1 && (tag as usize) < SINGLE_BYTE_TOKENS.len() {
            return Ok(SINGLE_BYTE_TOKENS[tag as usize].to_string());
        }

        match tag {
            Tags::DICTIONARY_0..=Tags::DICTIONARY_3 => {
                let dict_idx = (tag - Tags::DICTIONARY_0) as usize;
                let token_idx = self.next_byte()? as usize;
                Self::get_token_double(dict_idx, token_idx)
            }
            Tags::LIST_EMPTY => Ok(String::new()),
            Tags::BINARY_8 => {
                let len = self.next_byte()? as usize;
                self.read_string_from_chars(len)
            }
            Tags::BINARY_20 => {
                let len = self.read_int20()?;
                self.read_string_from_chars(len)
            }
            Tags::BINARY_32 => {
                let len = self.read_int(4, false)?;
                self.read_string_from_chars(len)
            }
            Tags::JID_PAIR => self.read_jid_pair(),
            Tags::FB_JID => self.read_fb_jid(),
            Tags::INTEROP_JID => self.read_interop_jid(),
            Tags::AD_JID => self.read_ad_jid(),
            Tags::HEX_8 | Tags::NIBBLE_8 => self.read_packed8(tag),
            _ => Err(ProtocolError::InvalidTag(tag)),
        }
    }

    fn read_list(&mut self, tag: u8) -> Result<Vec<BinaryNode>, ProtocolError> {
        let size = self.read_list_size(tag)?;
        let mut items = Vec::with_capacity(size);
        for _ in 0..size {
            items.push(self.decode_node()?);
        }
        Ok(items)
    }

    pub fn decode_node(&mut self) -> Result<BinaryNode, ProtocolError> {
        let list_tag = self.next_byte()?;
        let list_size = self.read_list_size(list_tag)?;
        let header_tag = self.next_byte()?;
        let header = self.read_string(header_tag)?;

        if list_size == 0 || header.is_empty() {
            return Err(ProtocolError::InvalidNode("empty node header".to_string()));
        }

        let mut attrs = HashMap::new();
        let attributes_length = (list_size - 1) >> 1;

        for _ in 0..attributes_length {
            let key_tag = self.next_byte()?;
            let key = self.read_string(key_tag)?;
            let val_tag = self.next_byte()?;
            let val = self.read_string(val_tag)?;
            attrs.insert(key, val);
        }

        let content = if list_size % 2 == 0 {
            let tag = self.next_byte()?;
            if Self::is_list_tag(tag) {
                Some(BinaryNodeContent::List(self.read_list(tag)?))
            } else {
                match tag {
                    Tags::BINARY_8 => {
                        let len = self.next_byte()? as usize;
                        Some(BinaryNodeContent::Bytes(self.read_bytes(len)?.to_vec()))
                    }
                    Tags::BINARY_20 => {
                        let len = self.read_int20()?;
                        Some(BinaryNodeContent::Bytes(self.read_bytes(len)?.to_vec()))
                    }
                    Tags::BINARY_32 => {
                        let len = self.read_int(4, false)?;
                        Some(BinaryNodeContent::Bytes(self.read_bytes(len)?.to_vec()))
                    }
                    _ => Some(BinaryNodeContent::String(self.read_string(tag)?)),
                }
            }
        } else {
            None
        };

        Ok(BinaryNode {
            tag: header,
            attrs,
            content,
        })
    }
}

pub fn decode_binary_node(buffer: &[u8]) -> Result<BinaryNode, ProtocolError> {
    if buffer.is_empty() {
        return Err(ProtocolError::EndOfStream);
    }
    // Skip prefix (0x00) if uncompressed
    let data = if buffer[0] == 0 {
        &buffer[1..]
    } else {
        buffer
    };
    let mut decoder = Decoder::new(data);
    decoder.decode_node()
}
