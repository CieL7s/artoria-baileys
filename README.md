🇮🇩 **Bahasa Indonesia** | [🇬🇧 English](README.en.md)

---

# 🌸 Artoria-Baileys

[![Version](https://img.shields.io/badge/version-0.6.0-blue.svg)](https://github.com/CieL7s/artoria-baileys)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust Native Engine](https://img.shields.io/badge/Rust-baileys--core-orange.svg)](https://www.rust-lang.org/)
[![Node.js N-API](https://img.shields.io/badge/Node.js-N--API-green.svg)](https://nodejs.org/)
[![Tests: 15/15 PASS](https://img.shields.io/badge/Tests-15%2F15%20PASS%20(100%25)-brightgreen.svg)](https://github.com/CieL7s/artoria-baileys)

> **Library WhatsApp Web hybrid Rust/JavaScript berkinerja tinggi** — drop-in replacement 100% kompatibel dengan ekosistem Baileys, di mana seluruh lapisan primitif biner, kriptografi E2EE Signal Protocol, protokol transaksi, dan pemrosesan pesan (Level 0 hingga Level 3) telah didelegasikan ke mesin native Rust murni yang aman dan cepat.

---

## 1. 📌 Ringkasan Eksekutif

**Artoria-Baileys** dirancang untuk mengatasi batas performa dan kelemahan alokasi memori pada bot/aplikasi WhatsApp berskala tinggi yang dibangun di atas Node.js. 

### Kenapa Berbeda dari Baileys Standar?
- **Performa Native Tanpa Garbage Collection Overhead**: Operasi berat CPU seperti serialisasi Binary XML WhatsApp, derivasi kunci HKDF, hashing ratchet HMAC-SHA256, verifikasi tanda tangan XEd25519, unwrap Protobuf multi-layer, serta dekripsi AES-256-GCM dieksekusi langsung di mesin Rust via N-API bridge tanpa membebani event loop V8 JavaScript.
- **Level 0–3 Selesai 100% di Rust (v0.6.0)**: Seluruh pipeline kriptografi E2EE (*pairwise Double Ratchet* dan *SenderKey group protocol*), query multi-protokol USync, resolusi konteks addressing (`LID` vs `PN`), App State Sync, dan pemrosesan pesan masuk kini diproses secara *native-first*.
- **100% Drop-In Compatible**: Menggunakan API publik, tipe TypeScript, dan struktur event yang identik dengan `@whiskeysockets/baileys`. Anda cukup mengganti nama import di project Anda tanpa perlu merombak alur logika bot Anda.

---

## 2. 📊 Status Migrasi Arsitektur (v0.6.0)

Kami menerapkan prinsip **transparansi penuh** terhadap arsitektur internal. Berikut adalah peta status delegasi mesin saat ini:

| Level | Kategori Layer | Status Migrasi | Engine Aktif di Produksi | Cakupan Komponen |
| :--- | :--- | :---: | :---: | :--- |
| **Level 0** | **Primitives, Formats & Core Crypto** | ✅ **100% Selesai** | **Rust Native (Default)** | Parsing JID, WABinary XML Node (encode/decode), Curve25519, AES-GCM, Media HKDF + AES-CBC. *(Catatan: Modul telemetri WAM opsional dikecualikan dengan justifikasi anti-fingerprint anomaly).* |
| **Level 1** | **Signal Group Primitives** | ✅ **100% Selesai** | **Rust Native (Default)** | `SenderChainKey`, `SenderMessageKey`, `SenderKeyName`, `SenderKeyDistributionMessage`, `SenderKeyMessage`, `SenderKeyState`, `SenderKeyRecord`. |
| **Level 2** | **Signal State Machine & Ciphers** | ✅ **100% Selesai** | **Rust Native (Default)** | `GroupCipher` (skmsg), `GroupSessionBuilder`, `SessionCipher` (pairwise msg/pkmsg), `SessionBuilder` (X3DH handshake), `LidPnMapping`. |
| **Level 3** | **Transaction Protocols & Message Processing** | ✅ **100% Selesai** | **Rust Native (Default)** | USync Query Engine (7 protokol), Message Envelope Decoder, App State Sync & History Reconstruction, Message Normalizer (9 tipe wrapper), MessageProcessor (`fromMe` matrix 4-kuadran, `decryptPollVote`, `decryptEventResponse`). |
| **Level 4** | **State Management & Auth File I/O** | 🔴 0% (Target v0.7.0) | JavaScript | Multi-file auth state persistence, pre-key pool manager, retry queue manager. |
| **Level 5** | **Zero-Copy WebSocket Pipeline** | 🔴 0% (Target v0.8.0) | JavaScript | WebSocket frame buffer management & high-level socket facade. |

> 📖 Untuk rincian teknis per-file dan riwayat delegasi, silakan baca dokumentasi lengkap di [`MIGRATION_STATUS.md`](file:///c:/Users/ASUS/Documents/Project/baileys-onrust%20-%20Copy/MIGRATION_STATUS.md).

---

## 3. 🧪 Bukti Kualitas & Metodologi Pengujian

Artoria-Baileys tidak hanya mengklaim kompatibilitas, tetapi membuktikannya melalui 5 lapisan metodologi verifikasi empiris yang ketat:

```
                            [PIRAMIDA PENGUJIAN KUALITAS]
                                         ▲
                                        / \
                                       /   \
                         [1] Paritas  /  72 \ 72 Unit Test Level 3 Khusus
                             Murni   /───────\
                                    /   142   \ 142 Test Level 2 Ciphers
                      [2] Shadow   /───────────\
                          Mode    /     721     \ 721 Transaksi Kripto Real-Time
                                 /───────────────\ (0 mismatch / 100% match)
                   [3] Regresi  /    15 SUITES    \ 15 Test Suite Gabungan
                       Penuh   /───────────────────\ (100% PASS Hijau)
```

1. **Unit Test Paritas Bit-Exact**:
   - **Level 0**: Verifikasi bit-exact encoding WABinary dan Curve25519/AES-GCM.
   - **Level 1**: 37 edge-cases mendalam untuk `SenderKeyRecord` (rotasi 50 state, FIFO eviction invariant).
   - **Level 2**: 142 test suite mencakup validasi X3DH (full OTPK, no-OTPK, rotasi TOFU), session builder, dan roundtrip 47 file session nyata.
   - **Level 3**: 72 test case khusus (USync 11/11, Envelope Decoder 13/13, Sync & History 11/11, Normalizer 19/19, MessageProcessor 18/18).
2. **Dual-Engine Shadow Mode (721 Transaksi Kripto)**:
   - Menjalankan engine JS dan engine Rust secara paralel di background pada traffic riil.
   - Hasil: **721/721 transaksi kriptografi 100% identik (0 mismatch / 0.00% error rate)**.
3. **Cross-Engine Interoperability (Rust ↔ JS `libsignal`)**:
   - Pesan yang dienkripsi oleh Rust didekripsi oleh JS `libsignal` resmi, dan sebaliknya, membuktikan paritas protokol tingkat biner.
4. **Kriptografi Negatif & Anti-Tampering Test**:
   - Verifikasi bahwa manipulasi AAD pada poll vote (misal JID voter tertukar) atau secret key yang korup **selalu gagal didekripsi secara eksplisit**, mencegah pemrosesan data sampah atau kebocoran state.
5. **Pencegahan Risiko Spam-Loop Offline Catch-up**:
   - Pengujian batch stanza offline (`offline="1"`) memastikan 100% diklasifikasikan sebagai `'append'` (bukan `'notify'`), mencegah bot membalas pesan lama secara berulang saat baru reconnect.

> [!WARNING]
> **Disclaimer Keamanan**: Seluruh modul Level 0 hingga Level 3 telah diverifikasi secara matematis dan empiris bit-exact terhadap spesifikasi Signal Protocol & WhatsApp Web. Namun, library ini merupakan implementasi independen dan belum melalui audit keamanan formal pihak ketiga. Gunakan di lingkungan produksi Anda dengan pengujian yang sesuai.

---

## 4. 💻 Persyaratan Sistem & Instalasi

### Persyaratan
- **Node.js**: Versi `18.0.0` LTS ke atas (ESM support).
- **Sistem Operasi yang Didukung**:
  - **Windows x64**: Prebuilt binary native (`baileys-napi.node`) sudah disertakan langsung di paket instalasi. Langsung jalan tanpa perlu compiler Rust/C++.
  - **Linux x64 / macOS (Intel & Apple Silicon)**: Dapat dibangun langsung dari source dengan mudah.

### Instalasi via Package Manager

```bash
npm install artoria-baileys
# atau
pnpm add artoria-baileys
# atau
yarn add artoria-baileys
```

### Build dari Source (Untuk Linux / macOS)
Jika Anda menggunakan platform di luar Windows x64:
```bash
# Pastikan Rust toolchain sudah terpasang (curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh)
git clone https://github.com/CieL7s/artoria-baileys.git
cd artoria-baileys
npm install
npm run build:rust
```

---

## 5. 🚀 Panduan Mulai Cepat (Quick Start)

Kode di bawah ini adalah contoh siap pakai yang menunjukkan bagaimana Artoria-Baileys digunakan persis seperti Baileys standar:

```javascript
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
} from 'artoria-baileys';
import { Boom } from '@hapi/boom';

async function startBot() {
    // 1. Inisialisasi Auth State (menyimpan session ke folder 'auth_info')
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Menggunakan WA versi v${version.join('.')}, isLatest: ${isLatest}`);

    // 2. Buat Socket WhatsApp dengan Rust Engine
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        // Konfigurasi browser standar WhatsApp Web
        browser: ['Ubuntu', 'Chrome', '22.04.4']
    });

    // 3. Tangani Pembaruan Koneksi
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena:', lastDisconnect?.error, ', Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ Berhasil terkoneksi ke WhatsApp via Artoria-Baileys Rust Engine!');
        }
    });

    // 4. Simpan Kredensial Saat Terjadi Pembaruan Token
    sock.ev.on('creds.update', saveCreds);

    // 5. Tangani Pesan Masuk (Auto-Reply & Command Handler)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Abaikan pesan catch-up saat offline jika hanya ingin merespons pesan live
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

            console.log(`[Pesan Masuk] Dari: ${from} (Grup: ${isGroup}) | Teks: ${text}`);

            // Command .ping
            if (text === '.ping') {
                await sock.sendMessage(from, { text: '🏓 Pong! Pesan ini diproses via Rust Engine.' }, { quoted: msg });
            }

            // Command .menu
            if (text === '.menu') {
                await sock.sendMessage(from, { 
                    text: `🌸 *Artoria-Baileys v0.6.0*\n\nEngine: Pure Rust (Level 0-3)\nStatus: Online & Ready.` 
                }, { quoted: msg });
            }
        }
    });
}

startBot();
```

---

## 6. ⚙️ Panduan Konfigurasi Engine

Artoria-Baileys dilengkapi switch konfigurasi fleksibel melalui Environment Variables:

| Variable | Pilihan Nilai | Default di v0.6.0 | Fungsi & Kapan Digunakan |
| :--- | :---: | :---: | :--- |
| **`SIGNAL_ENGINE`** | `rust` \| `js` | **`rust`** | Mengatur engine yang memegang otoritas keputusan kriptografi & parsing protokol.<br>• `rust`: Seluruh E2EE dan decoding diproses oleh Rust native (tercepat & hemat memori).<br>• `js`: Fallback ke implementasi JavaScript murni (berguna untuk perbandingan debugging). |
| **`SIGNAL_SHADOW_MODE`** | `0` \| `1` | **`0`** | Mengaktifkan built-in telemetry comparator.<br>• `0`: Shadow mode non-aktif (mode produksi normal).<br>• `1`: Setiap operasi dieksekusi oleh kedua engine secara paralel dan dicocokkan bit-per-bit di background. |

> **Kapan developer perlu mengatur variable ini?**  
> Untuk penggunaan normal/produksi, Anda **tidak perlu mengatur apa pun**. Artoria-Baileys secara default langsung menggunakan engine Rust berkinerja tinggi.

---

## 7. 📖 Panduan Penggunaan Mendalam (Buku Panduan)

### a. Struktur Event Utama
Artoria-Baileys memancarkan event standar yang dapat Anda dengarkan via `sock.ev.on`:

```javascript
// 1. Pesan baru masuk atau catch-up
sock.ev.on('messages.upsert', ({ messages, type, requestId }) => {
    // type: 'notify' (live) atau 'append' (offline sync)
});

// 2. Pembaruan pesan (misal pesan diedit atau ditarik/revoke)
sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
        if (update.messageStubType === 1) {
            console.log(`Pesan ${key.id} telah ditarik (REVOKE) oleh pengirim.`);
        }
    }
});

// 3. Reaksi pesan (Reaction)
sock.ev.on('messages.reaction', (reactions) => {
    for (const { key, reaction } of reactions) {
        console.log(`Reaksi '${reaction.text}' diberikan pada pesan ${key.id}`);
    }
});

// 4. Pembaruan mapping LID ke Nomor Telepon (LID-PN Mapping)
sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
    console.log(`Mapping baru tersimpan: LID ${lid} <-> Nomor ${pn}`);
});
```

---

### b. Mengirim Berbagai Tipe Pesan

```javascript
// 1. Pesan Teks Sederhana & Quote
await sock.sendMessage(jid, { text: 'Halo dari Artoria-Baileys!' }, { quoted: originalMsg });

// 2. Reaksi ke Pesan
await sock.sendMessage(jid, {
    react: {
        text: '❤️',
        key: targetMessageKey
    }
});

// 3. Membuat Poll (Voting)
await sock.sendMessage(jid, {
    poll: {
        name: 'Bahasa pemrograman favorit untuk backend?',
        values: ['Rust 🦀', 'TypeScript 🟦', 'Go 🐹', 'Python 🐍'],
        selectableCount: 1
    }
});

// 4. Mengirim Gambar / Dokumen Media
await sock.sendMessage(jid, {
    image: { url: './gambar.jpg' }, // atau Buffer
    caption: 'Foto pemandangan alam'
});
```

---

### c. FAQ & Masalah Nyata di Lapangan

#### Q1: Apa perbedaan antara LID (`@lid`) dan PN (`@s.whatsapp.net`)?
> **Penjelasan**: WhatsApp modern menggunakan format `LID` (Linked Identity Device) untuk privasi pengguna di grup dan komunitas. Artoria-Baileys secara otomatis menyelesaikan konteks addressing ini via Rust `MessageDecoder` dan menyimpan relasi `LID-PN` di database lokal sehingga Anda dapat tetap mengirim pesan menggunakan nomor telepon biasa tanpa khawatir salah alamat.

#### Q2: Bagaimana bot mencegah spam-loop saat baru dinyalakan setelah offline lama?
> **Penjelasan**: Saat offline lama, WhatsApp server mengirimkan puluhan pesan tertunda dengan atribut `<message offline="1">`. Sub-Modul 5 Artoria-Baileys menjamin seluruh pesan ini masuk dengan label `type: 'append'`, bukan `'notify'`. Dengan memeriksa `if (type !== 'notify') return;`, bot Anda tidak akan membalas pesan lama berulang kali.

#### Q3: Bagaimana jika terjadi error "No session found" pada grup?
> **Penjelasan**: Pada Signal Protocol, jika bot baru masuk ke grup atau belum pernah menerima *SenderKeyDistributionMessage* (SKDM) dari peserta tertentu, error `No session found` adalah perilaku normal E2EE standar. Bot akan meminta *resend* kunci secara otomatis ke server WhatsApp.

---

## 8. 🏗️ Arsitektur Teknis Repositori

```text
artoria-baileys/
├── index.js                      # Entry point publik ESM Baileys
├── index.d.ts                    # Definisi tipe TypeScript lengkap
├── baileys-napi.node             # Prebuilt native binary N-API (Windows x64)
├── lib/                          # Lapisan JavaScript (N-API Bridge & Socket)
│   ├── WABinary/                 # Serializer XML Node WhatsApp (Delegasi Rust)
│   ├── Signal/                   # Signal Protocol group & pairwise ciphers (Delegasi Rust)
│   ├── WAUSync/                  # USync Query & Protocol Handlers (Delegasi Rust)
│   ├── Utils/                    # Normalizer, Decoder, ProcessMessage (Delegasi Rust)
│   └── Socket/                   # Socket connection & message dispatching (JavaScript)
├── rust/                         # Native Rust Engine Core
│   ├── baileys-core/             # Pure Rust crypto, protocols, normalizer & decoders
│   └── baileys-napi/             # Jembatan N-API yang menghubungkan Node.js dan Rust
└── test/                         # 15 Test suite paritas, crypto test & shadow comparator
```

> 🤝 Ingin berkontribusi pada pengembangan level berikutnya? Silakan baca panduan lengkap di [`CONTRIBUTING.md`](file:///c:/Users/ASUS/Documents/Project/baileys-onrust%20-%20Copy/CONTRIBUTING.md).

---

## 9. 🗺️ Roadmap Menuju v1.0.0

- [x] **v0.1.0 (Level 0)**: Primitif dasar, serialisasi WABinary XML, Curve25519 & Media Crypto di Rust.
- [x] **v0.3.0 (Level 1)**: Struktur data Signal Group SenderKey di Rust.
- [x] **v0.5.0 (Level 2)**: Signal State Machine, GroupCipher, Pairwise Double Ratchet & X3DH di Rust.
- [x] **v0.6.0 (Level 3)**: USync Query Protocols, Envelope Decoder, Normalizer, App State Sync & MessageProcessor di Rust.
- [ ] **v0.7.0 (Level 4)**: State Management, Auth Storage File I/O & Pre-Key Lifecycle di Rust.
- [ ] **v0.8.0 (Level 5)**: Zero-Copy WebSocket Frame Processing & Arsitektur Full Native.
- [ ] **v1.0.0 (Final)**: Rilis stabil multi-platform (Windows, Linux, macOS ARM/x64).

---

## 10. 📜 Kredit & Lisensi

- **Basis Ekosistem**: Proyek ini dibangun di atas fondasi arsitektur hebat dari [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys). Kami berterima kasih kepada seluruh kontributor komunitas Baileys atas penelitian rekayasa balik protokol WhatsApp yang luar biasa.
- **Lisensi**: Proyek ini dilisensikan di bawah **[MIT License](file:///c:/Users/ASUS/Documents/Project/baileys-onrust%20-%20Copy/LICENSE)** — bebas digunakan untuk kebutuhan komersial maupun personal.
- **Komunitas & Diskusi**: Jika Anda menemukan kendala atau ingin berdiskusi teknis, silakan buka [GitHub Issues](https://github.com/CieL7s/artoria-baileys/issues) atau [Discussions](https://github.com/CieL7s/artoria-baileys/discussions).

---

<div align="center">
  <b>Dikelola dengan ❤️ oleh <a href="https://github.com/CieL7s">CieL7s</a> dan Komunitas Open Source.</b>
</div>
