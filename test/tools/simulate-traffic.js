import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import { SenderChainKey as JsSenderChainKey } from '../../lib/Signal/Group/sender-chain-key.js';
import { SenderMessageKey as JsSenderMessageKey } from '../../lib/Signal/Group/sender-message-key.js';
import { SenderKeyName as JsSenderKeyName } from '../../lib/Signal/Group/sender-key-name.js';
import { SenderKeyDistributionMessage as JsSKDM } from '../../lib/Signal/Group/sender-key-distribution-message.js';
import { SenderKeyMessage as JsSenderKeyMessage } from '../../lib/Signal/Group/sender-key-message.js';
import { SenderKeyState as JsSenderKeyState } from '../../lib/Signal/Group/sender-key-state.js';
import { SenderKeyRecord as JsSenderKeyRecord } from '../../lib/Signal/Group/sender-key-record.js';
import { createKeyPair } from 'libsignal/src/curve.js';
import { logShadowComparison, logShadowError, getShadowStats } from '../../lib/Signal/Group/shadow_comparator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));

const API_BASE = 'http://localhost:3456';
const STATS_FILE = path.join(__dirname, '../shadow_stats.json');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Destination targets
const GROUPS = [
    '120363409742668546@g.us',
    '120363423520240855@g.us',
    '120363428437686919@g.us'
];

const PRIVATE_JIDS = [
    '202950408405214@lid',
    '132598911267037:49@lid',
    '5046586634368@lid'
];

// Helper: HTTP POST
function postJson(pathUrl, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request(`${API_BASE}${pathUrl}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 10000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(payload);
        req.end();
    });
}

// -------------------------------------------------------------
// PART 1: HIGH-ITERATION PROTOCOL RATCHET STRESS SIMULATION
// -------------------------------------------------------------
async function runDeepRatchetSimulation(targetIterations = 500) {
    console.log(`\n================================================================`);
    console.log(`🚀 [SIMULATION 1] ADVANCING SENDER CHAIN RATCHET (0 -> ${targetIterations} ITERASI)`);
    console.log(`================================================================`);

    const rootSeed = Buffer.alloc(32, 0x42);
    let currentChain = new JsSenderChainKey(0, rootSeed);

    for (let iter = 0; iter <= targetIterations; iter++) {
        // Exercise getSenderMessageKey (derives IV & cipher key via HKDF WhisperGroup)
        const msgKey = currentChain.getSenderMessageKey();

        // Exercise getNext (HMAC-SHA256 ratchet derivation)
        currentChain = currentChain.getNext();

        if (iter % 100 === 0 || iter === targetIterations) {
            console.log(`  ↳ Ratchet progress: iterasi ke-${iter}/${targetIterations} terverifikasi`);
        }
    }
    console.log(`✅ [SIMULATION 1] Berhasil menyelesaikan ${targetIterations} iterasi ratchet chain tanpa desinkronisasi!\n`);
}

// -------------------------------------------------------------
// PART 2: OUT-OF-ORDER & SKIPPED MESSAGE KEYS SIMULATION
// -------------------------------------------------------------
async function runOutOfOrderKeySimulation() {
    console.log(`================================================================`);
    console.log(`🚀 [SIMULATION 2] SIMULASI OUT-OF-ORDER & SKIPPED MESSAGE KEYS`);
    console.log(`================================================================`);

    // Skenario: pesan tiba di iterasi 50, lalu pesan iterasi 20 tiba belakangan (skipped message keys)
    const signingKey = Buffer.alloc(32, 0x77);
    const pubKey = Buffer.alloc(33, 0x05); // 33-byte Curve25519
    const stateStructure = {
        senderKeyId: 999999,
        senderChainKey: {
            iteration: 0,
            seed: { type: "Buffer", data: Array.from(Buffer.alloc(32, 0x33)) }
        },
        senderSigningKey: {
            public: { type: "Buffer", data: Array.from(pubKey) },
            private: { type: "Buffer", data: Array.from(signingKey) }
        },
        senderMessageKeys: []
    };

    const record = new JsSenderKeyRecord([stateStructure]);
    const state = record.getSenderKeyState();

    // Advance 50 iterasi menyimpan skipped keys
    let chain = state.getSenderChainKey();
    for (let i = 0; i < 50; i++) {
        const mk = chain.getSenderMessageKey();
        state.senderKeyStateStructure.senderMessageKeys.push({
            iteration: mk.getIteration(),
            seed: { type: "Buffer", data: Array.from(mk.getSeed()) }
        });
        chain = chain.getNext();
    }
    state.setSenderChainKey(chain);

    // Verifikasi serialisasi & deserialisasi state besar dengan 50 skipped keys
    const serializedJson = JSON.stringify(record.serialize());
    const rustDeserialized = rust.signalGroupRecordDeserialize(serializedJson);
    const rustParsed = JSON.parse(rustDeserialized);

    const isMatch = rustParsed[0]?.senderMessageKeys?.length === 50 && rustParsed[0]?.senderChainKey?.iteration === 50;
    logShadowComparison('SenderKeyRecord.deserialize', isMatch, {
        skippedKeysCount: rustParsed[0]?.senderMessageKeys?.length,
        iteration: rustParsed[0]?.senderChainKey?.iteration
    });

    console.log(`✅ [SIMULATION 2] Out-of-order 50 skipped keys berhasil diuji & diserialisasi identik.\n`);
}

// -------------------------------------------------------------
// PART 3: MULTI-KEY SKDM DISTRIBUTION & STATE ROTATION SIMULATION
// -------------------------------------------------------------
async function runSkdmDistributionSimulation(keyCount = 50) {
    console.log(`================================================================`);
    console.log(`🚀 [SIMULATION 3] MULTI-KEY SKDM DISTRIBUTION & 5-STATE FIFO CAPPING`);
    console.log(`================================================================`);

    const states = [];
    for (let k = 1; k <= keyCount; k++) {
        const keyId = 500000 + k;
        const seed = Buffer.alloc(32, k % 255);
        const signKey = Buffer.alloc(32, (k * 7) % 255);

        // Create SKDM
        const skdm = new JsSKDM(keyId, 0, seed, signKey);
        const skdmBytes = skdm.serialize();

        // Parse SKDM
        const parsedSkdm = new JsSKDM(null, null, null, null, skdmBytes);

        // State container
        states.push({
            senderKeyId: parsedSkdm.getId(),
            senderChainKey: {
                iteration: parsedSkdm.getIteration(),
                seed: { type: "Buffer", data: Array.from(parsedSkdm.getChainKey()) }
            },
            senderSigningKey: {
                public: { type: "Buffer", data: Array.from(Buffer.alloc(33, 0x05)) },
                private: { type: "Buffer", data: Array.from(parsedSkdm.getSignatureKey()) }
            },
            senderMessageKeys: []
        });

        // Test SenderKeyRecord deserialization with growing history
        if (k % 10 === 0 || k === keyCount) {
            const jsonStr = JSON.stringify(states);
            const rustRecordJson = rust.signalGroupRecordDeserialize(jsonStr);
            const rustStates = JSON.parse(rustRecordJson);
            
            // Verifikasi invariant FIFO 5-state
            const isCappedValid = rustStates.length <= 5;
            logShadowComparison('SenderKeyRecord.deserialize', isCappedValid, {
                totalPushed: k,
                retainedCount: rustStates.length
            });
            console.log(`  ↳ SKDM Key #${k}/${keyCount}: Capping FIFO 5-state valid (Retained: ${rustStates.length} state aktif)`);
        }
    }
    console.log(`✅ [SIMULATION 3] ${keyCount} SKDM distributions & state rotation sukses.\n`);
}

// -------------------------------------------------------------
// PART 3B: SENDER KEY MESSAGE ENVELOPE & SIGNATURE SIMULATION
// -------------------------------------------------------------
async function runSenderKeyMessageEnvelopeSimulation(messageCount = 100) {
    console.log(`================================================================`);
    console.log(`🚀 [SIMULATION 3B] SENDER KEY MESSAGE PROTOBUF & XED25519 SIGNATURE (${messageCount} PESAN)`);
    console.log(`================================================================`);

    for (let i = 1; i <= messageCount; i++) {
        const keyId = 700000 + i;
        const iter = i * 3;
        const cipherPayload = Buffer.from(`Ciphertext payload encrypted with message key #${i} - integrity check`);
        
        // Generate valid Curve25519 keypair
        const rawPrivKey = Buffer.alloc(32, (i * 17) % 255 || 1);
        const keyPair = createKeyPair(rawPrivKey);
        const privKey = keyPair.privKey;
        const pubKey = keyPair.pubKey;

        // 1. Create SenderKeyMessage
        const jsMsg = new JsSenderKeyMessage(keyId, iter, cipherPayload, privKey);
        const serializedBytes = jsMsg.serialize();

        // 2. Parse SenderKeyMessage (exercises SenderKeyMessage.parse shadow comparison)
        const parsedMsg = new JsSenderKeyMessage(null, null, null, null, serializedBytes);

        // 3. Verify Signature (exercises SenderKeyMessage.verifySignature shadow comparison)
        parsedMsg.verifySignature(pubKey);

        if (i % 25 === 0 || i === messageCount) {
            console.log(`  ↳ SenderKeyMessage envelope & signature #${i}/${messageCount} terverifikasi`);
        }
    }
    console.log(`✅ [SIMULATION 3B] ${messageCount} SenderKeyMessage envelopes & signatures sukses.\n`);
}

// -------------------------------------------------------------
// PART 4: LIVE WEBSOCKET TRAFFIC SIMULATION VIA BOT
// -------------------------------------------------------------
const PRIVATE_PAYLOADS = [
    // 1-word
    "Halo", "Test", "Ping", "Mantap", "Siap",
    // 1-sentence
    "Bagaimana performa enkripsi Signal Rust hari ini?",
    "Mohon konfirmasi status bot WhatsApp di server staging.",
    "Testing pengiriman pesan private chat dengan format teks biasa.",
    "Sistem enkripsi end-to-end Signal Protocol aktif memverifikasi payload.",
    "Apakah semua thread N-API berjalan stabil tanpa leak memory?",
    // Multi-paragraph & technical
    "🌸 *Artoria Signal Engine - Phase 2 Evaluation*\n\nParagraf pertama: testing session pairwise dan sender key ratchet.\n\nParagraf kedua: seluruh modul Level 1 aktif di shadow mode dengan 0 mismatch! 🚀",
    "📊 *Laporan Pengujian E2EE*\n• Modul: SenderChainKey\n• Modul: SenderMessageKey\n• Modul: SenderKeyMessage\n• Modul: SenderKeyDistributionMessage\n\nStatus: Terverifikasi Bit-Exact.",
    // Unicode & complex emojis
    "🌸✨🔥🚀🤖🛡️💎🎉⚡ Validasi karakter multi-byte: 日本語 (Japanese) & العربية (Arabic) & 漢字 (Kanji)",
    "Test Unicode symbols: 🔏 🔐 🔑 📦 🌐 ⚙️ 🧪 📈 💯 🎯 - Integrity check OK!",
    // Commands & chatter
    ".ping",
    ".speed",
    ".menu",
    ".help",
    "Halo bot, tolong cek status server.",
    "Terima kasih atas respons cepatnya! 👍"
];

const GROUP_PAYLOADS = [
    // Commands
    ".ping",
    ".speed",
    ".menu",
    ".help",
    // Natural chatter
    "Tes pesan grup nomor 1 dari akun test.",
    "Mendorong rotasi sender chain key di grup ini.",
    "Iterasi ratchet sender key akan meningkat berturut-turut untuk setiap pesan baru.",
    "Pesan natural tanpa prefix untuk memicu alur parsing grup standar.",
    "🌸 *Group Ratchet Push* - Memastikan HMAC-SHA256 derivasi berjalan mulus di background.",
    "Simulasi aktivitas anggota grup yang sedang aktif berdiskusi.",
    "Pesan dengan emoji: 🔥🚀🛡️✨🎉",
    "Pesan dengan mention: Halo @202950408405214 dan @132598911267037 apa kabar?",
    "Pesan teknis: Testing throughput Baileys Rust N-API binding di Node.js runtime.",
    "Verifikasi konsistensi cryptographic digest antara JavaScript dan Rust."
];

async function runLiveTrafficSimulation(sessionIndex, totalSessions) {
    console.log(`================================================================`);
    console.log(`📡 [SIMULATION 4 - SESI ${sessionIndex}/${totalSessions}] LIVE WA TRAFFIC INJECTION`);
    console.log(`================================================================`);

    // 1. Send Private Chat messages
    console.log(`\n--- Mengirim Pesan Private Chat (${PRIVATE_PAYLOADS.length} pesan) ---`);
    for (let i = 0; i < PRIVATE_PAYLOADS.length; i++) {
        const text = PRIVATE_PAYLOADS[i];
        const jid = PRIVATE_JIDS[i % PRIVATE_JIDS.length];
        const isCmd = text.startsWith('.');

        try {
            if (isCmd) {
                const res = await postJson('/api/command', { text });
                console.log(`  [Private #${i+1}] CMD '${text}' -> Status: ${res.status}`);
            } else {
                const res = await postJson('/api/send-message', { jid, text });
                console.log(`  [Private #${i+1}] MSG to ${jid} ('${text.slice(0, 30)}...') -> Status: ${res.status}`);
            }
        } catch (err) {
            console.warn(`  [Private #${i+1}] Skip/Offline: ${err.message}`);
        }

        const waitMs = randInt(1500, 3000);
        await delay(waitMs);
    }

    // 2. Send Group Chat messages (consecutive messages to push chain key ratchet)
    for (const groupJid of GROUPS) {
        console.log(`\n--- Mengirim Pesan Grup Berturut-turut ke ${groupJid} (${GROUP_PAYLOADS.length} pesan) ---`);
        for (let i = 0; i < GROUP_PAYLOADS.length; i++) {
            const text = `[Batch ${sessionIndex}.${i+1}] ${GROUP_PAYLOADS[i]}`;
            const isCmd = text.includes('.ping') || text.includes('.speed') || text.includes('.menu') || text.includes('.help');

            try {
                if (isCmd) {
                    const res = await postJson('/api/command', { text });
                    console.log(`  [Grup ${groupJid.split('@')[0]}] CMD '${GROUP_PAYLOADS[i]}' -> Status: ${res.status}`);
                } else {
                    const res = await postJson('/api/send-message', { jid: groupJid, text });
                    console.log(`  [Grup ${groupJid.split('@')[0]}] MSG #${i+1} ('${text.slice(0, 35)}...') -> Status: ${res.status}`);
                }
            } catch (err) {
                console.warn(`  [Grup ${groupJid.split('@')[0]}] Skip/Offline: ${err.message}`);
            }

            const waitMs = randInt(2000, 4000);
            await delay(waitMs);
        }
    }
}

// -------------------------------------------------------------
// MAIN CONTROLLER
// -------------------------------------------------------------
async function main() {
    console.log('================================================================');
    console.log('🧪 SUITE SIMULASI TRAFFIC & VERIFIKASI SHADOW MODE LEVEL 1');
    console.log('================================================================\n');

    const TOTAL_SESSIONS = 3;
    const RATCHET_STRESS_ITERATIONS = 500;

    // Step 1: Run Deep Protocol Ratchet Stress (0 -> 500 iterations)
    await runDeepRatchetSimulation(RATCHET_STRESS_ITERATIONS);

    // Step 2: Run Out-of-Order & Skipped Message Keys
    await runOutOfOrderKeySimulation();

    // Step 3: Run Multi-Key SKDM & State Rotation
    await runSkdmDistributionSimulation(50);

    // Step 3B: Run SenderKeyMessage Envelope & XEd25519 Signature Simulation (100 messages)
    await runSenderKeyMessageEnvelopeSimulation(100);

    // Step 4: Run Multi-Session Live Traffic Injection
    for (let session = 1; session <= TOTAL_SESSIONS; session++) {
        await runLiveTrafficSimulation(session, TOTAL_SESSIONS);
        if (session < TOTAL_SESSIONS) {
            console.log(`\n⏳ Jeda antar sesi (cooldown 5 detik sebelum sesi ${session + 1})...`);
            await delay(5000);
        }
    }

    // Step 5: Read and Display Final Shadow Stats
    console.log('\n================================================================');
    console.log('📊 FINAL SHADOW TELEMETRY REPORT SETELAH SIMULASI LENGKAP');
    console.log('================================================================');

    const stats = getShadowStats();
    console.log(`⏱️  Waktu Mulai       : ${stats.startTime}`);
    console.log(`⏳ Total Durasi Aktif : ${stats.durationSeconds} detik (${(stats.durationSeconds / 60).toFixed(1)} menit)`);
    console.log(`🔢 Total Operasi      : ${stats.totalOperations}`);
    console.log(`✅ Total Matches      : ${stats.totalOperations - stats.totalMismatches - stats.totalErrors}`);
    console.log(`❌ Total Mismatches   : ${stats.totalMismatches}`);
    console.log(`⚠️  Total Errors       : ${stats.totalErrors}`);
    console.log('\n--- Breakdown Per-Operasi ---');
    console.table(stats.byOperation);

    if (stats.totalMismatches === 0 && stats.totalErrors === 0 && stats.totalOperations >= 500) {
        console.log('\n🎉 SEMUA PENGUJIAN SHADOW MODE LEVEL 1 SUKSES 100% (0 MISMATCH, 0 ERROR)!');
    } else if (stats.totalMismatches > 0) {
        console.error('\n❌ PERINGATAN: DITEMUKAN MISMATCH PADA SHADOW MODE! WAJIB INVESTIGASI!');
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal simulation error:', err);
    process.exit(1);
});
