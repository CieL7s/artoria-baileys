# MASTER PRODUCT REQUIREMENTS DOCUMENT (PRD)
## PROJECT: AURIEL-BAILEYS (PURE RUST ENGINE PORT)

---

## 1. Executive Summary & Vision Statement

### 1.1 Objective
Membangun library klien WhatsApp Web modern berkinerja tinggi yang **100% berjalan di atas Rust core (`baileys-core` & `baileys-napi`)**, **MENGGANTIKAN TOTAL** implementasi JavaScript `@whiskeysockets/baileys` bawaan.

### 1.2 Core Pillars
1. **Zero JS Baileys Dependency**: Tidak menggunakan satu baris pun kode JavaScript dari runtime `@whiskeysockets/baileys`. Folder `lib/` dihapus total dari repository.
2. **Native Performance**: Seluruh proses I/O WebSocket (Tokio), kriptografi (Noise XX, Curve25519, AES-256-GCM, AES-CBC-128, HMAC-SHA256, HKDF), serialisasi WABinary, dan state machine ditangani langsung di memori native Rust.
3. **Drop-in JavaScript Interface**: Menyediakan wrapper NAPI tipis di JavaScript (`index.js`) yang mengekspor fungsi `makeWASocket` dan event-driven emitter (`connection.update`, `messages.upsert`, `creds.update`) agar kompatibel penuh dengan bot eksternal seperti `Artoria-MD`.

---

## 2. System Architecture & Component Design

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      APLIKASI BOT / PENGGUNA (Artoria-MD)                         │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ (JavaScript API / EventEmitter)
┌────────────────────────────────────────▼──────────────────────────────────────────┐
│                   AURIEL-BAILEYS NAPI BRIDGE (`baileys-napi`)                     │
│  - WhatsAppClient (Class NAPI pengatur lifecycle koneksi)                         │
│  - Threadsafe Function Dispatcher (Mengalirkan event tokio ke EventEmitter JS)    │
│  - Direct native bindings: jidEncode, decodeBinaryNode, encryptMedia, dll.       │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ (Direct Rust FFI)
┌────────────────────────────────────────▼──────────────────────────────────────────┐
│                     AURIEL-BAILEYS CORE (`baileys-core`)                          │
├───────────────────────────────────────────────────────────────────────────────────┤
│ 1. Network Layer (`connection/`):                                                 │
│    - tokio-tungstenite WebSocket Client ke `wss://web.whatsapp.com/ws/chat`       │
│    - Multiplexer Frame Reader & Writer dengan buffer queue async                  │
│                                                                                   │
│ 2. Cryptographic Layer (`noise/`, `media/`, `auth/`):                             │
│    - Noise XX Handshake State Machine (`WA\x06\x03`, Curve25519, AES-GCM)        │
│    - Transport State: enkripsi/dekripsi frame binary stanzas                      │
│    - Media Cipher: AES-CBC-128 + HMAC-SHA256 streaming buffer                     │
│                                                                                   │
│ 3. Protocol & Binary Node Layer (`protocol/`):                                    │
│    - WABinary Tokenizer (Dictionary Token v3)                                     │
│    - Zero-copy BinaryNode Serializer & Deserializer                               │
│    - JID Parser (PN, LID, Group, Newsletter, Broadcast)                          │
│                                                                                   │
│ 4. Authentication & Linking (`auth/`, `sync/`):                                   │
│    - Session storage JSON (`creds.json`, PreKeys, SignedKeys)                     │
│    - QR Code Builder (`https://wa.me/settings/linked_devices#...`)                │
│    - Pairing Code Generator (AES-CTR PreKey Encryption `link_code_companion_reg`)│
│                                                                                   │
│ 5. Feature Stanza Builders (`groups/`, `newsletter/`, `communities/`, `business/`)│
│    - Group, Newsletter, Community, Catalog, USync, AppState Sync MAC builders    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specification per Rust Module

### 3.1 Network & Noise Protocol (`baileys-core::connection` & `baileys-core::noise`)
* **Header Handshake**: Header biner `NOISE_HEADER = [87, 65, 6, 3]` (`WA\x06\x03`).
* **Noise Pattern**: `Noise_XX_25519_AESGCM_SHA256\0\0\0\0` (32 bytes).
* **Alur Handshake**:
  1. Client mengirim `ClientHello` (ephemeral key 32 bytes) dalam frame pertama berprefix `WA\x06\x03`.
  2. Server merespons dengan `ServerHello` (ephemeral server, encrypted cert, encrypted payload).
  3. Client memvalidasi sertifikat WhatsApp (`WA_CERT_DETAILS.PUBLIC_KEY`), menginisiasi derivasi static key, dan mengirim `ClientFinish`.
  4. Transisi ke `TransportState` dengan sepasang kunci AES-256-GCM (`enc_key` & `dec_key`).

### 3.2 Binary Node Serializer/Deserializer (`baileys-core::protocol`)
* **`BinaryNode` Struct**:
  ```rust
  pub struct BinaryNode {
      pub tag: String,
      pub attrs: HashMap<String, String>,
      pub content: Option<BinaryNodeContent>,
  }
  ```
* **`BinaryNodeContent` Serde Compatibility**:
  ```rust
  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(untagged)]
  pub enum BinaryNodeContent {
      String(String),
      Bytes(Vec<u8>),
      List(Vec<BinaryNode>),
      NodeBuffer(NodeBufferObject),
  }
  ```
* **Tokenizer**: Mengimplementasikan `SINGLE_BYTE_TOKENS` dan `DOUBLE_BYTE_TOKENS` sesuai spesifikasi WhatsApp Web v3.

### 3.3 Linking & Pairing Engine (`baileys-core::auth` & `connection`)
1. **QR Code Flow**:
   - Menunggu stanza server `<iq type="set"><pair-device><ref>REF_DATA</ref></pair-device></iq>`.
   - Mengambil `ref`, `noiseKey.public`, `identityKey.public`, `advSecretKey`.
   - Menghasilkan string QR: `https://wa.me/settings/linked_devices#<ref>,<noisePubB64>,<identPubB64>,<advSecretB64>,1`.
   - Merender ASCII QR di terminal menggunakan crate `qrcode`.
2. **Pairing Code Flow (Nomor WA)**:
   - Men-generate salt 32-byte dan derivasi kunci pairing melalui HKDF-SHA256.
   - Enkripsi ephemeral public key dengan AES-CTR.
   - Mengirim stanza IQ `link_code_companion_reg` ke WhatsApp server.
   - Server mengembalikan kode Crockford Base32 8-karakter (misal: `VAXE-CETQ`).

### 3.4 Media Cryptography (`baileys-core::media`)
* **Enkripsi File**:
  - Input: Buffer media mentah + `media_type` (Image, Audio, Video, Document, Sticker).
  - Derivasi: HKDF-SHA256 dari `media_key` (112 bytes: `iv` 16B, `cipher_key` 32B, `mac_key` 32B, `ref_key` 32B).
  - Cipher: AES-CBC-128 enkripsi + HMAC-SHA256 tanda tangan file (10 bytes pertama diappend ke ciphertext).

### 3.5 Feature Stanza Builders (`groups`, `newsletter`, `communities`, `business`, `sync`, `wam`)
* Seluruh stanza XML/BinaryNode dibuild di memori native Rust:
  - `GroupBuilder`: Membuat grup, add/remove peserta, update subject, get invite link.
  - `NewsletterBuilder`: Membuat saluran, follow/unfollow, mute/unmute.
  - `CommunityBuilder`: Membuat komunitas, link/unlink grup induk.
  - `BusinessBuilder`: Query katalog, detail produk, order.
  - `AppStateSync`: Perhitungan MAC HMAC-SHA256 untuk mutasi chat, pin, archive, read receipt.
  - `WamEncoder`: Binary serializer untuk telemetri event WhatsApp.

---

## 4. NAPI Integration Layer (`baileys-napi` & `index.js`)

### 4.1 Rust NAPI Class: `WhatsAppClient`
```rust
#[napi]
pub struct WhatsAppClient {
    core: Arc<WhatsAppClientCore>,
    runtime: Arc<Runtime>,
}

#[napi]
impl WhatsAppClient {
    #[napi(constructor)]
    pub fn new(auth_folder: String) -> Result<Self>;

    #[napi]
    pub fn connect(&self) -> Result<()>;

    #[napi]
    pub fn on_event(&self, env: Env, callback: JsFunction) -> Result<()>;

    #[napi]
    pub fn request_pairing_code(&self, phone_number: String) -> Result<String>;

    #[napi]
    pub fn send_message(&self, to_jid: String, text: String) -> Result<String>;

    #[napi]
    pub fn send_raw_node(&self, node_json: String) -> Result<()>;
}
```

### 4.2 JavaScript Entry Point (`index.js`)
* Tanpa impor apapun dari Baileys JS.
* Menyediakan adapter `makeWASocket(config)` yang menghubungkan `WhatsAppClient` NAPI ke `EventEmitter` JavaScript.
* Mengekspor helper `jidEncode`, `decodeBinaryNode`, `encryptMedia`, `Browsers`, `DisconnectReason`, `proto`.

---

## 5. Implementation & Execution Plan

| Fase | Target Modul | Deskripsi Pekerjaan |
| :--- | :--- | :--- |
| **Fase 1** | `baileys-core::noise` & `connection` | Perbaiki transisi Noise XX handshake `WA\x06\x03` dan WebSocket message streaming di tokio loop. |
| **Fase 2** | `baileys-core::protocol` | Validasi tokenizer token v3 dan perbaiki fleksibilitas Serde `BinaryNodeContent` agar zero-error. |
| **Fase 3** | `baileys-core::auth` & `client` | Implementasi server `<pair-device>` QR listener dan stanza pairing code `link_code_companion_reg`. |
| **Fase 4** | `baileys-napi` & `index.js` | Sempurnakan threadsafe event bridge NAPI dan adapter JS `makeWASocket`. |
| **Fase 5** | Cleanup & Verification | Hapus total folder `lib/` Baileys JS bawaan, jalankan `cargo build --release`, dan uji live di `Artoria-MD`. |

---

## 6. Definition of Done (DoD) & Acceptance Criteria

1. **0 Dependencies on JS Baileys**: File `lib/` dihapus, tidak ada impor `@whiskeysockets/baileys`.
2. **Kompilasi Bersih**: `cargo build --package baileys-napi --release` menghasilkan `baileys_napi.node` tanpa warning/error.
3. **Live WhatsApp Connection**: Berhasil terhubung ke WhatsApp Web via `WhatsAppClient` Rust.
4. **Scan QR Code (Opsi 1)**: Menampilkan QR Code resmi dari server WhatsApp di terminal.
5. **Pairing Code (Opsi 2)**: Menghasilkan kode pairing 8 digit dan berhasil menautkan perangkat di HP WhatsApp.
6. **Kirim/Terima Pesan**: Berhasil mengirim dan menerima pesan teks/media langsung dari bot `Artoria-MD`.
