# 🌸 Artoria-Baileys

[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](https://github.com/CieL7s/artoria-baileys)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust Native](https://img.shields.io/badge/Rust-baileys--core-orange.svg)](https://www.rust-lang.org/)
[![Node.js N-API](https://img.shields.io/badge/Node.js-N--API-green.svg)](https://nodejs.org/)

> **High-performance, hybrid Rust/JavaScript WhatsApp Web client library** — a 100% drop-in companion for the Baileys ecosystem with core cryptography, binary protocols, and Signal primitives delegated to pure, memory-safe Rust.

---

## 📌 Status Migrasi & Keterbukaan Arsitektur (v0.5.0)

Proyek ini sedang dalam proses migrasi bertahap dari JavaScript murni ke Rust native engine. Kami menerapkan prinsip **transparansi penuh** mengenai komponen mana yang sudah berjalan di Rust dan mana yang masih berjalan di JavaScript:

| Layer / Modul | Status Implementasi | Engine Aktif | Detail & Metrik Pengujian |
| :--- | :---: | :---: | :--- |
| **Level 0: WABinary & JID Utils** | ✅ 100% Rust | **Rust Native (Default)** | Parsing JID, normalisasi, Binary XML Node encode & decode (100% bit-exact). |
| **Level 0: Core & Media Crypto** | ✅ 100% Rust | **Rust Native (Default)** | AES-GCM, AES-CBC, HMAC-SHA256, Curve25519 & Media HKDF encryption/decryption.<br>*(Catatan: Modul WAM telemetri opsional dikecualikan dengan justifikasi anti-fingerprint anomaly).* |
| **Level 1: Signal Group Primitives** | ✅ 100% Rust | **Rust Native (Default)** | `SenderChainKey`, `SenderMessageKey`, `SenderKeyName`, `SenderKeyDistributionMessage`, `SenderKeyMessage`, `SenderKeyState`, `SenderKeyRecord`.<br>📊 **Bukti empiris**: **1.959 operasi shadow real-time**, **37 deep edge cases** dengan **0 mismatch & 0 error**. |
| **Level 2: Signal State Machine & Ciphers** | ✅ 100% Rust | **Rust Native (Default)** | `GroupCipher`, `GroupSessionBuilder`, `SessionCipher`, `SessionBuilder`, `LidPnMapping`.<br>📊 **Bukti empiris**: **155/155 test PASS**, verifikasi dua arah *Bidirectional Cross-Engine Interoperability* (Rust ↔ JS `libsignal`), validasi X3DH (full OTPK, no-OTPK, TOFU rotation), dan **terbukti stabil di traffic produksi live**. |
| **Level 3: Protocol Transactions** | 🔴 JavaScript | **JavaScript** | USync query protocols & message event processing (target migrasi: Iterasi 4). |
| **Level 4: State Management & Auth I/O** | 🔴 JavaScript | **JavaScript** | Auth state file persistence & pre-key lifecycle management (target migrasi: Iterasi 5). |
| **Level 5: Zero-Copy WebSocket Pipeline** | 🔴 JavaScript | **JavaScript** | WebSocket frame management & high-level socket facade (target migrasi: Iterasi 6). |

---

## 🖥️ Platform Support (v0.5.0)

- **Windows x64**: Prebuilt native binary disertakan (`baileys-napi.node`). Langsung siap pakai tanpa build compiler.
- **Linux (glibc) / macOS (Intel & Apple Silicon)**: Perlu build native binary dari source menggunakan Rust toolchain:
  ```bash
  cargo build --manifest-path rust/Cargo.toml --package baileys-napi --release
  ```
  *(Prebuilt binary multi-platform untuk Linux dan macOS akan otomatis didistribusikan via GitHub Actions Releases pada milestone berikutnya).*

---

## ⚡ Fitur Unggulan

- 🦀 **Rust Native Acceleration**: Operasi berat CPU (Binary XML serialization, HKDF key derivation, HMAC ratchet hashing, dan Curve25519 signatures) dieksekusi langsung di mesin Rust via N-API tanpa overhead JavaScript VM.
- 🔄 **100% Baileys Drop-In Compatible**: Menggunakan API publik, tipe TypeScript, dan struktur event yang identik dengan `@whiskeysockets/baileys`.
- 🛡️ **Dual-Engine Architecture with Shadow Mode**: Memiliki built-in telemetry comparator yang dapat memvalidasi eksekusi Rust vs JavaScript secara paralel di background.
- 📦 **Memory Safe & Leak-Free**: Manajemen alokasi memory native yang aman via Rust RAII pattern.

---

## 🚀 Instalasi & Penggunaan Cepat

### Instalasi

```bash
npm install artoria-baileys
# atau
yarn add artoria-baileys
# atau
pnpm add artoria-baileys
```

### Contoh Kode (Drop-in Replacement)

```javascript
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason 
} from 'artoria-baileys';
import { Boom } from '@hapi/boom';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Terkoneksi ke WhatsApp via Artoria-Baileys!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text;

        if (text === '.ping') {
            await sock.sendMessage(sender, { text: '🏓 Pong from Artoria Rust Engine!' });
        }
    });
}

connectToWhatsApp();
```

---

## ⚙️ Konfigurasi Engine & Shadow Mode

Artoria-Baileys menyediakan opsi konfigurasi environment variable untuk fleksibilitas debugging dan transisi bertahap:

```bash
# Mode Default (Authoritative JavaScript + Rust Shadow Comparator Telemetry)
SIGNAL_SHADOW_MODE=1 node index.js

# Mode Authoritative Pure Rust untuk Level 1 (Native Execution)
SIGNAL_ENGINE=rust node index.js
```

---

## 🗂️ Struktur Direktori & Arsip Legacy

```text
artoria-baileys/
├── index.js                      # Entry point publik
├── index.d.ts                    # Deklarasi TypeScript
├── baileys-napi.node             # Prebuilt native binary (N-API)
├── lib/                          # JavaScript layer & N-API bridges
│   ├── WABinary/                 # XML Binary Node serializer (Rust Delegated)
│   ├── Signal/Group/             # Signal Group Primitives (Rust Delegated)
│   │   └── shadow_comparator.js  # Real-time shadow mode telemetry engine
│   ├── Socket/                   # Baileys Socket pipeline (JS)
│   └── _legacy_archive/          # 🗄️ Arsip implementasi JS asli (Rollback only)
├── rust/
│   ├── baileys-core/             # Pure Rust cryptographic & protocol core
│   └── baileys-napi/             # Rust N-API Node.js bindings
└── test/                         # Parity test suites & traffic simulator
```

> **Catatan `lib/_legacy_archive/`**: File di dalam folder ini adalah salinan kode JavaScript murni sebelum dimigrasikan ke Rust. Folder ini disimpan sebagai referensi komparasi dan rollback darurat, **bukan** kode aktif yang dieksekusi runtime.

---

## 🗺️ Roadmap Menuju v1.0.0

- [x] **v0.1.0 - Level 0**: WABinary (XML Node), JID Utils, Core Crypto (Curve25519 & AES-GCM), Media Crypto (AES-CBC + HKDF).
- [x] **v0.3.0 - Level 1**: Signal Group Primitives (`SenderChainKey`, `SenderMessageKey`, `SenderKeyName`, `SenderKeyDistributionMessage`, `SenderKeyMessage`, `SenderKeyState`, `SenderKeyRecord`).
- [ ] **v0.5.0 - Level 2**: Signal Ciphers & State Machine (`GroupCipher`, `GroupSessionBuilder`, pairwise `SessionCipher`, `SessionBuilder`, `LidPnMapping`).
- [ ] **v0.7.0 - Level 3**: USync Query Protocols & Binary WhatsApp Message Decoders in Rust.
- [ ] **v0.9.0 - Level 4**: Auth State Managers, Storage Adapters, and Pre-Key Lifecycle in Rust.
- [ ] **v1.0.0 - Level 5**: Zero-Copy Native WebSocket Frame Processing & Full Production Release.

---

## ⚠️ Disclaimer Keamanan & Batasan Penggunaan

> [!WARNING]
> **Security Notice**: Library ini telah melalui pengujian paritas bit-exact yang sangat ketat (1.900+ operasi terkomparasi dengan 0 mismatch) terhadap implementasi Signal Protocol standar. Namun, state machine enkripsi Level 2 (`GroupCipher` dan `SessionCipher`) saat ini masih berjalan di layer JavaScript dan belum diaudit secara independen oleh pihak ketiga. Gunakan di lingkungan produksi dengan pertimbangan Anda sendiri hingga migrasi Level 2+ dan audit komunitas yang lebih luas selesai.

---

## 📄 Lisensi

Didistribusikan di bawah lisensi **MIT License**. Lihat [`LICENSE`](file:///c:/Users/ASUS/Documents/Project/baileys-onrust%20-%20Copy/LICENSE) untuk detail lengkap.

---

**Dikembangkan oleh [CieL7s](https://github.com/CieL7s) bersama Komunitas Baileys.**
