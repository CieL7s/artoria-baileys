use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("End of stream reached unexpectedly")]
    EndOfStream,
    #[error("Invalid token index: {0}")]
    InvalidTokenIndex(u8),
    #[error("Invalid double token dict: {0}, index: {1}")]
    InvalidDoubleToken(usize, usize),
    #[error("Invalid tag: {0}")]
    InvalidTag(u8),
    #[error("Invalid hex nibble: {0}")]
    InvalidHex(u8),
    #[error("Invalid nibble: {0}")]
    InvalidNibble(u8),
    #[error("Invalid JID pair")]
    InvalidJidPair,
    #[error("Invalid node structure: {0}")]
    InvalidNode(String),
    #[error("String too large to encode: {0}")]
    StringTooLarge(usize),
    #[error("Too many bytes to pack: {0}")]
    TooManyBytesToPack(usize),
    #[error("UTF-8 decode error: {0}")]
    Utf8Error(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeBufferObject {
    #[serde(rename = "type")]
    pub buf_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BinaryNodeContent {
    String(String),
    NodeBuffer(NodeBufferObject),
    Bytes(Vec<u8>),
    List(Vec<BinaryNode>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinaryNode {
    pub tag: String,
    pub attrs: HashMap<String, String>,
    pub content: Option<BinaryNodeContent>,
}

impl BinaryNode {
    pub fn new(tag: impl Into<String>) -> Self {
        Self {
            tag: tag.into(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn with_attr(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.attrs.insert(key.into(), value.into());
        self
    }

    pub fn with_attrs(mut self, attrs: HashMap<String, String>) -> Self {
        self.attrs = attrs;
        self
    }

    pub fn with_content(mut self, content: BinaryNodeContent) -> Self {
        self.content = Some(content);
        self
    }

    pub fn with_string_content(mut self, text: impl Into<String>) -> Self {
        self.content = Some(BinaryNodeContent::String(text.into()));
        self
    }

    pub fn with_bytes_content(mut self, bytes: Vec<u8>) -> Self {
        self.content = Some(BinaryNodeContent::Bytes(bytes));
        self
    }

    pub fn with_children(mut self, list: Vec<BinaryNode>) -> Self {
        self.content = Some(BinaryNodeContent::List(list));
        self
    }

    pub fn get_attr(&self, key: &str) -> Option<&str> {
        self.attrs.get(key).map(|s| s.as_str())
    }

    pub fn get_child(&self, tag: &str) -> Option<&BinaryNode> {
        if let Some(BinaryNodeContent::List(children)) = &self.content {
            children.iter().find(|child| child.tag == tag)
        } else {
            None
        }
    }

    pub fn get_children(&self, tag: &str) -> Vec<&BinaryNode> {
        if let Some(BinaryNodeContent::List(children)) = &self.content {
            children.iter().filter(|child| child.tag == tag).collect()
        } else {
            Vec::new()
        }
    }

    pub fn get_content_string(&self) -> Option<String> {
        match &self.content {
            Some(BinaryNodeContent::String(s)) => Some(s.clone()),
            Some(BinaryNodeContent::Bytes(b)) => String::from_utf8(b.clone()).ok(),
            _ => None,
        }
    }

    pub fn get_child_string(&self, tag: &str) -> Option<String> {
        self.get_child(tag).and_then(|child| child.get_content_string())
    }

    pub fn get_bytes_content(&self) -> Option<&[u8]> {
        if let Some(BinaryNodeContent::Bytes(b)) = &self.content {
            Some(b.as_slice())
        } else {
            None
        }
    }

    pub fn get_child_bytes(&self, tag: &str) -> Option<&[u8]> {
        self.get_child(tag).and_then(|child| child.get_bytes_content())
    }
}
