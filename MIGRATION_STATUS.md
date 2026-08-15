# 📊 Artoria-Baileys Rust Migration Status Tracker

Dokumen ini melacak status migrasi end-to-end dari JavaScript (`lib/`) ke Pure Rust Native Engine (`rust/baileys-core` & `rust/baileys-napi`).
Setiap iterasi yang selesai WAJIB memperbarui status di tabel ini.

---

## 📌 Ringkasan Status Keseluruhan

| Level | Kategori Modul | Total Modul | Rust Delegated | Native JS | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Level 0** | Primitives & Formats (WABinary, JID, Core Crypto, Media) | 6 | 5 | 1 | 🟡 83% Selesai |
| **Level 1** | Signal Group Primitives (SenderKey Data Structures) | 7 | 7 | 0 | ✅ 100% Selesai (Battle-Tested) |
| **Level 2** | Signal Ciphers & State Machine (Group & Pairwise) | 4 | 0 | 4 | 🔴 0% (Target Iterasi 3) |
| **Level 3** | Transaction Protocols & Message Processing | 5 | 0 | 5 | 🔴 0% (Target Iterasi 4) |
| **Level 4** | State Managers & Auth File I/O | 4 | 0 | 4 | 🔴 0% (Target Iterasi 5) |
| **Level 5** | Socket Pipeline & Public API Facade | 4 | 0 | 4 | 🔴 0% (Target Iterasi 6) |

---

## 📋 Status Rinci Per-Modul

### Level 0: Primitives, Formats & Core Cryptography
| Modul / File | Status | Engine Aktif | Backup Legacy | Catatan |
| :--- | :---: | :---: | :---: | :--- |
| `lib/WABinary/jid-utils.js` | ✅ FULLY DELEGATED | **Rust** (`rust.jidDecode`, `rust.jidEncode`, `rust.jidNormalizedUser`) | `jid-utils.legacy.js` | Parsing & normalisasi JID 100% Rust. Helper JS tipis dipertahankan untuk DX. |
| `lib/WABinary/encode.js` | ✅ FULLY DELEGATED | **Rust** (`rust.encodeBinaryNode`) | `encode.legacy.js` | Encoding Node XML ke Binary WhatsApp 100% Rust. |
| `lib/WABinary/decode.js` | ✅ FULLY DELEGATED | **Rust** (`rust.decodeBinaryNode`) | `decode.legacy.js` | Decoding Binary WhatsApp ke Node XML 100% Rust. |
| `lib/Utils/crypto.js` (Primitif) | ✅ FULLY DELEGATED | **Rust** (`curve25519_sign`, `curve25519_verify`, `aes_gcm`) | - | Primitif Curve25519 & AES-GCM diuji bit-exact dengan Rust. |
| `lib/Utils/messages-media.js` (Crypto) | ✅ FULLY DELEGATED | **Rust** (`rust.encryptMedia`, `rust.decryptMedia`) | - | Media crypto (AES-CBC + SHA256 HKDF) 100% Rust. |
| `lib/WAM/encode.js` & `constants.js` | 🔴 NOT STARTED | **JavaScript** | - | Down-graded: WamEncoder di Rust baru berupa header stub 14-baris. Perlu porting kamus 800KB. |

---

### Level 1: Signal Group Primitives (Iterasi 2 - Selesai & Terverifikasi)
| Modul / File | Status | Engine Aktif | Backup Legacy | Catatan |
| :--- | :---: | :---: | :---: | :--- |
| `lib/Signal/Group/sender-chain-key.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderChainKey`) | `sender-chain-key.legacy.js` | 551 iterasi ratchet 100% match identik (0 mismatch). |
| `lib/Signal/Group/sender-message-key.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderMessageKey`) | `sender-message-key.legacy.js` | HKDF WhisperGroup derivation (IV 16B + Key 32B) 551 runs 100% match. |
| `lib/Signal/Group/sender-key-name.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderKeyName`) | `sender-key-name.legacy.js` | Identitas unik SenderKey (`groupId::sender::deviceId`). |
| `lib/Signal/Group/sender-key-distribution-message.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderKeyDistributionMessage`) | `sender-key-distribution-message.legacy.js` | Protobuf SKDM create & parse 50 rotasi key 100% match. |
| `lib/Signal/Group/sender-key-message.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderKeyMessage`) | `sender-key-message.legacy.js` | Protobuf envelope & XEd25519 signature validator 100 runs 100% match. |
| `lib/Signal/Group/sender-key-state.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderKeyState`) | `sender-key-state.legacy.js` | Container key ID, chain key, signing key (32/33B fix), & 50 skipped keys. |
| `lib/Signal/Group/sender-key-record.js` | ✅ FULLY DELEGATED | **Rust N-API** (`baileys_core::signal::group::SenderKeyRecord`) | `sender-key-record.legacy.js` | 37 deep edge cases (0, 1, 3, 5, 20 states + FIFO eviction) 100% match. |

---

### Level 2: Signal State Machine & Ciphers (Target: Iterasi 3)
| Modul / File | Status | Engine Aktif | Target Rust Module | Catatan |
| :--- | :---: | :---: | :--- | :--- |
| `lib/Signal/Group/group_cipher.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::signal::group::GroupCipher` | Enkripsi & dekripsi pesan grup (`skmsg`). |
| `lib/Signal/Group/group-session-builder.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::signal::group::GroupSessionBuilder` | Ingest/process SKDM ke `SenderKeyRecord`. |
| `lib/Signal/libsignal.js` (Pairwise Engine) | 🔴 NOT STARTED | **JavaScript** | `baileys_core::signal::session::SessionCipher` | Pairwise Double Ratchet Signal Protocol (`pkmsg`/`msg`). |
| `lib/Signal/lid-mapping.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::signal::LidPnMapping` | Mapping & cache PN-to-LID & LID-to-PN. |

---

### Level 3: Transaction Protocols & Message Processing (Target: Iterasi 4)
| Modul / File | Status | Engine Aktif | Target Rust Module | Catatan |
| :--- | :---: | :---: | :--- | :--- |
| `lib/WAUSync/*` (Query & Protocols) | 🔴 NOT STARTED | **JavaScript** | `baileys_core::usync` | Multi-protocol USync query & response parsing. |
| `lib/Utils/decode-wa-message.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::message::MessageDecoder` | Unpack protobuf payload WA E2E (SKDM, viewOnce, reaction). |
| `lib/Utils/process-message.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::message::MessageProcessor` | Processing unread count, upsert emitter, chat sync. |
| `lib/Utils/messages.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::message::MessageBuilder` | Protobuf builder untuk seluruh variasi pesan WA. |
| `lib/Utils/sync-action-utils.js` & `history.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::sync::AppStateSync` | App State Sync patches & initial history sync. |

---

### Level 4: State Management & File I/O (Target: Iterasi 5)
| Modul / File | Status | Engine Aktif | Target Rust Module | Catatan |
| :--- | :---: | :---: | :--- | :--- |
| `lib/Utils/use-multi-file-auth-state.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::auth::FileAuthState` | Multi-file JSON key storage (kompatibel penuh 100% Baileys). |
| `lib/Utils/message-retry-manager.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::connection::RetryManager` | Antrean retry stanza dropped / E2EE decrypt failure. |
| `lib/Utils/pre-key-manager.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::auth::PreKeyManager` | Batch generator & uploader prekey baru saat kuota menipis. |
| `lib/Utils/identity-change-handler.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::auth::IdentityHandler` | TOFU Public Identity Key change handler. |

---

### Level 5: Top-Level Socket & Public Facade (Target: Iterasi 6)
| Modul / File | Status | Engine Aktif | Target Rust Module | Catatan |
| :--- | :---: | :---: | :--- | :--- |
| `lib/Socket/messages-send.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::client::OutboundPipeline` | `assertSessions` & `createParticipantNodes` pipeline. |
| `lib/Socket/messages-recv.js` | 🔴 NOT STARTED | **JavaScript** | `baileys_core::client::InboundPipeline` | Inbound stanza router & event dispatcher. |
| `lib/Socket/socket.js` & Sub-services | 🔴 NOT STARTED | **JavaScript** | `baileys_core::client::WhatsAppClientCore` | WebSocket lifecycle & event loop bridge. |
| `lib/index.js` | 🔴 NOT STARTED | **JavaScript** | N-API Facade Layer | Public API surface (`sock.sendMessage`, `sock.ev.on`). |
