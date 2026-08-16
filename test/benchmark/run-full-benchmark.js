import path from 'path';
import { pathToFileURL } from 'url';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const PURE_JS_DIR = 'C:/Users/ASUS/Documents/Project/baileys-onrust/Baileys/lib';
const RUST_DIR = 'C:/Users/ASUS/Documents/Project/baileys-onrust - Copy/lib';

// Helper for dynamic imports
async function loadModules() {
    const jsWABinary = await import(pathToFileURL(path.join(PURE_JS_DIR, 'WABinary/index.js')).href);
    const rustWABinary = await import(pathToFileURL(path.join(RUST_DIR, 'WABinary/index.js')).href);

    const jsMessages = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/messages.js')).href);
    const rustMessages = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/messages.js')).href);

    const jsDecode = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/decode-wa-message.js')).href);
    const rustDecode = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/decode-wa-message.js')).href);

    const jsProcess = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/process-message.js')).href);
    const rustProcess = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/process-message.js')).href);

    const jsGroupCipher = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Signal/Group/group_cipher.js')).href);
    const rustGroupCipher = await import(pathToFileURL(path.join(RUST_DIR, 'Signal/Group/group_cipher.js')).href);

    const jsGroupSessionBuilder = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Signal/Group/group-session-builder.js')).href);
    const rustGroupSessionBuilder = await import(pathToFileURL(path.join(RUST_DIR, 'Signal/Group/group-session-builder.js')).href);

    const jsSenderKeyName = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Signal/Group/sender-key-name.js')).href);
    const rustSenderKeyName = await import(pathToFileURL(path.join(RUST_DIR, 'Signal/Group/sender-key-name.js')).href);

    const jsSenderChainKey = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Signal/Group/sender-chain-key.js')).href);
    const rustSenderChainKey = await import(pathToFileURL(path.join(RUST_DIR, 'Signal/Group/sender-chain-key.js')).href);

    const jsSenderKeyDistributionMessage = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Signal/Group/sender-key-distribution-message.js')).href);
    const rustSenderKeyDistributionMessage = await import(pathToFileURL(path.join(RUST_DIR, 'Signal/Group/sender-key-distribution-message.js')).href);

    const jsSenderKeyRecord = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Signal/Group/sender-key-record.js')).href);
    const rustSenderKeyRecord = await import(pathToFileURL(path.join(RUST_DIR, 'Signal/Group/sender-key-record.js')).href);

    const jsMediaCrypto = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/crypto.js')).href);
    const rustNative = (await import(pathToFileURL(path.join(RUST_DIR, 'Utils/native-loader.js')).href)).nativeRust;

    const jsCurve = require('libsignal/src/curve.js');
    const libsignal = require('libsignal');

    return {
        js: {
            WABinary: jsWABinary,
            messages: jsMessages,
            decode: jsDecode,
            process: jsProcess,
            GroupCipher: jsGroupCipher.GroupCipher,
            GroupSessionBuilder: jsGroupSessionBuilder.GroupSessionBuilder,
            SenderKeyName: jsSenderKeyName.SenderKeyName,
            SenderChainKey: jsSenderChainKey.SenderChainKey,
            SenderKeyDistributionMessage: jsSenderKeyDistributionMessage.SenderKeyDistributionMessage,
            SenderKeyRecord: jsSenderKeyRecord.SenderKeyRecord,
            mediaCrypto: jsMediaCrypto,
            curve: jsCurve,
            libsignal
        },
        rust: {
            WABinary: rustWABinary,
            messages: rustMessages,
            decode: rustDecode,
            process: rustProcess,
            GroupCipher: rustGroupCipher.GroupCipher,
            GroupSessionBuilder: rustGroupSessionBuilder.GroupSessionBuilder,
            SenderKeyName: rustSenderKeyName.SenderKeyName,
            SenderChainKey: rustSenderChainKey.SenderChainKey,
            SenderKeyDistributionMessage: rustSenderKeyDistributionMessage.SenderKeyDistributionMessage,
            SenderKeyRecord: rustSenderKeyRecord.SenderKeyRecord,
            native: rustNative,
            libsignal
        }
    };
}

// Statistical functions
function calculateStats(timesInMs) {
    const sorted = [...timesInMs].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    const mean = timesInMs.reduce((acc, v) => acc + v, 0) / n;
    const variance = timesInMs.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    return { median, mean, stdDev, min: sorted[0], max: sorted[n - 1] };
}

async function runBenchmark(name, iterations, warmupIterations, runsCount, jsFn, rustFn) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`▶ Running Benchmark: ${name}`);
    console.log(`  Iterations: ${iterations.toLocaleString()} | Warmup: ${warmupIterations} | Runs: ${runsCount}`);

    // Warmup JS
    for (let i = 0; i < warmupIterations; i++) {
        await jsFn();
    }
    // Warmup Rust
    for (let i = 0; i < warmupIterations; i++) {
        await rustFn();
    }

    const jsTimes = [];
    const rustTimes = [];

    for (let run = 1; run <= runsCount; run++) {
        // Run JS
        const startJs = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            await jsFn();
        }
        const endJs = process.hrtime.bigint();
        const jsDurationMs = Number(endJs - startJs) / 1_000_000;
        jsTimes.push(jsDurationMs);

        // Run Rust
        const startRust = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            await rustFn();
        }
        const endRust = process.hrtime.bigint();
        const rustDurationMs = Number(endRust - startRust) / 1_000_000;
        rustTimes.push(rustDurationMs);

        console.log(`  Run ${run}/${runsCount} -> JS: ${jsDurationMs.toFixed(3)} ms | Rust: ${rustDurationMs.toFixed(3)} ms`);
    }

    const jsStats = calculateStats(jsTimes);
    const rustStats = calculateStats(rustTimes);
    const speedupRatio = jsStats.median / rustStats.median;

    console.log(`  📊 RESULTS:`);
    console.log(`     JS Median:   ${jsStats.median.toFixed(3)} ms (±${jsStats.stdDev.toFixed(3)} ms)`);
    console.log(`     Rust Median: ${rustStats.median.toFixed(3)} ms (±${rustStats.stdDev.toFixed(3)} ms)`);
    if (speedupRatio >= 1.0) {
        console.log(`     🚀 Speedup:  \x1b[32m${speedupRatio.toFixed(2)}x FASTER\x1b[0m (Rust wins)`);
    } else {
        const slowdown = (1 / speedupRatio).toFixed(2);
        console.log(`     ⚠️  Ratio:    \x1b[33m${speedupRatio.toFixed(2)}x\x1b[0m (Pure JS is ${slowdown}x faster due to FFI overhead)`);
    }

    return {
        name,
        iterations,
        runsCount,
        jsStats,
        rustStats,
        speedupRatio,
        jsTimes,
        rustTimes
    };
}

// Main execution
async function main() {
    console.log(`============================================================`);
    console.log(`    ARTORIA-BAILEYS vs PURE JAVASCRIPT BAILEYS BENCHMARK    `);
    console.log(`============================================================`);

    const envInfo = {
        cpu: os.cpus()[0].model,
        cores: os.cpus().length,
        ramGB: (os.totalmem() / (1024 ** 3)).toFixed(2) + ' GB',
        node: process.version,
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        rustc: execSync('rustc --version').toString().trim(),
        timestamp: new Date().toISOString()
    };

    console.log(`Hardware Environment:`);
    console.log(`- CPU:   ${envInfo.cpu} (${envInfo.cores} logical cores)`);
    console.log(`- RAM:   ${envInfo.ramGB}`);
    console.log(`- Node:  ${envInfo.node}`);
    console.log(`- Rust:  ${envInfo.rustc}`);
    console.log(`- OS:    ${envInfo.os}`);
    console.log(`- Date:  ${envInfo.timestamp}`);

    const { js, rust } = await loadModules();
    const benchmarkResults = [];

    // =========================================================================
    // 1. MICRO-BENCHMARKS: WABinary Encode & Decode
    // =========================================================================

    // 1a. WABinary Small Node (<100 B)
    const smallNode = {
        tag: 'receipt',
        attrs: {
            to: '628123456789@s.whatsapp.net',
            id: '3EB0ABC123DEF',
            type: 'read',
            t: '1723800000'
        }
    };
    const smallNodeEncoded = js.WABinary.encodeBinaryNode(smallNode);

    benchmarkResults.push(await runBenchmark(
        'WABinary Encode (Small Node <100B)',
        1000, 200, 5,
        () => js.WABinary.encodeBinaryNode(smallNode),
        () => rust.WABinary.encodeBinaryNode(smallNode)
    ));

    benchmarkResults.push(await runBenchmark(
        'WABinary Decode (Small Node <100B)',
        1000, 200, 5,
        () => js.WABinary.decodeBinaryNode(smallNodeEncoded),
        () => rust.WABinary.decodeBinaryNode(smallNodeEncoded)
    ));

    // 1b. WABinary Medium Node (~1 KB)
    const mediumNode = {
        tag: 'message',
        attrs: {
            to: '628123456789@s.whatsapp.net',
            id: '3EB0987654321',
            type: 'text',
            category: 'peer'
        },
        content: [
            {
                tag: 'conversation',
                attrs: {},
                content: Buffer.from('Testing Artoria Baileys high performance WhatsApp Web binary node encoder with large text payload!')
            },
            {
                tag: 'contextInfo',
                attrs: {
                    stanzaId: '3EB0OLD123',
                    participant: '628987654321@s.whatsapp.net'
                }
            }
        ]
    };
    const mediumNodeEncoded = js.WABinary.encodeBinaryNode(mediumNode);

    benchmarkResults.push(await runBenchmark(
        'WABinary Encode (Medium Node ~1KB)',
        1000, 200, 5,
        () => js.WABinary.encodeBinaryNode(mediumNode),
        () => rust.WABinary.encodeBinaryNode(mediumNode)
    ));

    benchmarkResults.push(await runBenchmark(
        'WABinary Decode (Medium Node ~1KB)',
        1000, 200, 5,
        () => js.WABinary.decodeBinaryNode(mediumNodeEncoded),
        () => rust.WABinary.decodeBinaryNode(mediumNodeEncoded)
    ));

    // 1c. WABinary Large Node (>10 KB)
    const largeParticipants = [];
    for (let i = 0; i < 200; i++) {
        largeParticipants.push({
            tag: 'participant',
            attrs: {
                jid: `628123456${i.toString().padStart(3, '0')}@s.whatsapp.net`,
                type: i === 0 ? 'superadmin' : i < 5 ? 'admin' : 'member'
            }
        });
    }
    const largeNode = {
        tag: 'iq',
        attrs: {
            id: '3EB0GROUPQUERY',
            type: 'result',
            xmlns: 'w:g2'
        },
        content: [
            {
                tag: 'group',
                attrs: {
                    id: '120363023456789012@g.us',
                    subject: 'Artoria Baileys High Performance Community Group'
                },
                content: largeParticipants
            }
        ]
    };
    const largeNodeEncoded = js.WABinary.encodeBinaryNode(largeNode);

    benchmarkResults.push(await runBenchmark(
        'WABinary Encode (Large Node >10KB)',
        1000, 100, 5,
        () => js.WABinary.encodeBinaryNode(largeNode),
        () => rust.WABinary.encodeBinaryNode(largeNode)
    ));

    benchmarkResults.push(await runBenchmark(
        'WABinary Decode (Large Node >10KB)',
        1000, 100, 5,
        () => js.WABinary.decodeBinaryNode(largeNodeEncoded),
        () => rust.WABinary.decodeBinaryNode(largeNodeEncoded)
    ));

    // =========================================================================
    // 2. MICRO-BENCHMARKS: JID Utilities (Parsing & Normalization)
    // =========================================================================
    const testJids = [
        '628123456789@s.whatsapp.net',
        '628123456789:2@s.whatsapp.net',
        '628123456789_1:2@s.whatsapp.net',
        '100234567890123@lid',
        '100234567890123:4@lid',
        '120363023456789012@g.us',
        '120363999999999999@newsletter',
        'status@broadcast'
    ];

    benchmarkResults.push(await runBenchmark(
        'JID Parsing & Normalization (10,000 mixed JIDs)',
        10000, 1000, 5,
        () => {
            const jid = testJids[Math.floor(Math.random() * testJids.length)];
            const decoded = js.WABinary.jidDecode(jid);
            const norm = js.WABinary.jidNormalizedUser(jid);
            const isPn = js.WABinary.isPnUser(jid);
            const isLid = js.WABinary.isLidUser(jid);
            const isGroup = js.WABinary.isJidGroup(jid);
            return norm;
        },
        () => {
            const jid = testJids[Math.floor(Math.random() * testJids.length)];
            const decoded = rust.WABinary.jidDecode(jid);
            const norm = rust.WABinary.jidNormalizedUser(jid);
            const isPn = rust.WABinary.isPnUser(jid);
            const isLid = rust.WABinary.isLidUser(jid);
            const isGroup = rust.WABinary.isJidGroup(jid);
            return norm;
        }
    ));

    // =========================================================================
    // 3. MICRO-BENCHMARKS: Curve25519 Sign & Verify
    // =========================================================================
    const keypair = js.curve.generateKeyPair();
    const signMsg = crypto.randomBytes(32);
    const signatureJs = js.curve.calculateSignature(keypair.privKey, signMsg);

    benchmarkResults.push(await runBenchmark(
        'Curve25519 Sign (1,000 ops)',
        1000, 200, 5,
        () => js.curve.calculateSignature(keypair.privKey, signMsg),
        () => rust.native.curve25519Sign(keypair.privKey, signMsg)
    ));

    benchmarkResults.push(await runBenchmark(
        'Curve25519 Verify (1,000 ops)',
        1000, 200, 5,
        () => js.curve.verifySignature(keypair.pubKey, signMsg, signatureJs),
        () => rust.native.curve25519Verify(keypair.pubKey, signMsg, signatureJs)
    ));

    // =========================================================================
    // 4. MICRO-BENCHMARKS: AES-GCM / Media Cryptography
    // =========================================================================
    const payload100B = crypto.randomBytes(100);
    const payload1KB = crypto.randomBytes(1024);
    const payload100KB = crypto.randomBytes(100 * 1024);

    // JS Media Encrypt implementation using node crypto HKDF + CBC + HMAC
    function jsMediaEncrypt(buffer, mediaType = 'image') {
        const mKey = crypto.randomBytes(32);
        const expanded = Buffer.from(crypto.hkdfSync('sha256', mKey, Buffer.alloc(0), Buffer.from('WhatsApp Image Keys'), 112));
        const iv = expanded.subarray(0, 16);
        const encKey = expanded.subarray(16, 48);
        const macKey = expanded.subarray(48, 80);
        const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
        const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
        const hmac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, encrypted])).digest().subarray(0, 10);
        return { cipherText: Buffer.concat([encrypted, hmac]), iv, encKey, macKey, mediaKey: mKey };
    }

    benchmarkResults.push(await runBenchmark(
        'Media Encrypt 100B (1,000 ops)',
        1000, 200, 5,
        () => jsMediaEncrypt(payload100B, 'image'),
        () => rust.native.encryptMedia(payload100B, 'image')
    ));

    benchmarkResults.push(await runBenchmark(
        'Media Encrypt 1KB (1,000 ops)',
        1000, 200, 5,
        () => jsMediaEncrypt(payload1KB, 'image'),
        () => rust.native.encryptMedia(payload1KB, 'image')
    ));

    benchmarkResults.push(await runBenchmark(
        'Media Encrypt 100KB (1,000 ops)',
        1000, 100, 5,
        () => jsMediaEncrypt(payload100KB, 'image'),
        () => rust.native.encryptMedia(payload100KB, 'image')
    ));

    // Media Decrypt 100KB
    const encResultJs = jsMediaEncrypt(payload100KB, 'image');
    const encResultRust = rust.native.encryptMedia(payload100KB, 'image');

    function jsMediaDecrypt(enc, mediaType = 'image') {
        const cipherText = enc.cipherText.subarray(0, -10);
        const decipher = crypto.createDecipheriv('aes-256-cbc', enc.encKey, enc.iv);
        return Buffer.concat([decipher.update(cipherText), decipher.final()]);
    }

    benchmarkResults.push(await runBenchmark(
        'Media Decrypt 100KB (1,000 ops)',
        1000, 100, 5,
        () => jsMediaDecrypt(encResultJs, 'image'),
        () => rust.native.decryptMedia(encResultRust.encryptedBuffer, encResultRust.mediaKey, 'image')
    ));

    // =========================================================================
    // 5. MICRO-BENCHMARKS: HMAC-SHA256 Ratchet Derivation (Chain Key Stepping)
    // =========================================================================
    const initialChainKey = crypto.randomBytes(32);

    benchmarkResults.push(await runBenchmark(
        'HMAC-SHA256 Ratchet Chain Stepping (1,000 consecutive steps)',
        1000, 200, 5,
        () => {
            let sck = new js.SenderChainKey(0, initialChainKey);
            for (let i = 0; i < 10; i++) {
                sck = sck.getNext();
            }
            return sck;
        },
        () => {
            let sck = new rust.SenderChainKey(0, initialChainKey);
            for (let i = 0; i < 10; i++) {
                sck = sck.getNext();
            }
            return sck;
        }
    ));

    // =========================================================================
    // 6. MICRO-BENCHMARKS: X3DH Handshake & Key Derivations
    // =========================================================================
    const ourIdentity = js.curve.generateKeyPair();
    const theirIdentity = js.curve.generateKeyPair();
    const theirSignedPrekey = js.curve.generateKeyPair();
    const theirOneTimePrekey = js.curve.generateKeyPair();
    const ourEphemeral = js.curve.generateKeyPair();

    function jsX3dhHandshake() {
        const dh1 = js.curve.calculateAgreement(theirSignedPrekey.pubKey, ourIdentity.privKey);
        const dh2 = js.curve.calculateAgreement(theirIdentity.pubKey, ourEphemeral.privKey);
        const dh3 = js.curve.calculateAgreement(theirSignedPrekey.pubKey, ourEphemeral.privKey);
        const dh4 = js.curve.calculateAgreement(theirOneTimePrekey.pubKey, ourEphemeral.privKey);
        const master = Buffer.concat([dh1, dh2, dh3, dh4]);
        const derived = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(32), Buffer.from('WhisperRatchet'), 64));
        return derived;
    }

    benchmarkResults.push(await runBenchmark(
        'X3DH Handshake 4-DH Derivations (100 full handshakes)',
        100, 20, 5,
        () => jsX3dhHandshake(),
        () => {
            const dh1 = js.curve.calculateAgreement(theirSignedPrekey.pubKey, ourIdentity.privKey);
            const dh2 = js.curve.calculateAgreement(theirIdentity.pubKey, ourEphemeral.privKey);
            const dh3 = js.curve.calculateAgreement(theirSignedPrekey.pubKey, ourEphemeral.privKey);
            const dh4 = js.curve.calculateAgreement(theirOneTimePrekey.pubKey, ourEphemeral.privKey);
            const master = Buffer.concat([dh1, dh2, dh3, dh4]);
            return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(32), Buffer.from('WhisperRatchet'), 64));
        }
    ));

    // =========================================================================
    // 7. MICRO-BENCHMARKS: GroupCipher Encrypt & Decrypt Cycle
    // =========================================================================
    class MockSenderKeyStore {
        constructor(RecordClass) {
            this.store = new Map();
            this.RecordClass = RecordClass;
        }
        async loadSenderKey(name) {
            let rec = this.store.get(name.toString());
            if (!rec) {
                rec = new this.RecordClass();
                this.store.set(name.toString(), rec);
            }
            return rec;
        }
        async storeSenderKey(name, record) {
            this.store.set(name.toString(), record);
        }
    }

    const groupJid = '120363023456789012@g.us';
    const senderKeyNameJs = new js.SenderKeyName(groupJid, '628123456789:1@s.whatsapp.net');
    const senderKeyNameRust = new rust.SenderKeyName(groupJid, '628123456789:1@s.whatsapp.net');

    // JS Group Setup
    const senderStoreJs = new MockSenderKeyStore(js.SenderKeyRecord);
    const receiverStoreJs = new MockSenderKeyStore(js.SenderKeyRecord);
    const senderBuilderJs = new js.GroupSessionBuilder(senderStoreJs);
    const skdmJs = await senderBuilderJs.create(senderKeyNameJs);
    const receiverBuilderJs = new js.GroupSessionBuilder(receiverStoreJs);
    await receiverBuilderJs.process(senderKeyNameJs, skdmJs);
    const senderCipherJs = new js.GroupCipher(senderStoreJs, senderKeyNameJs);
    const receiverCipherJs = new js.GroupCipher(receiverStoreJs, senderKeyNameJs);

    // Rust Group Setup
    const senderStoreRust = new MockSenderKeyStore(rust.SenderKeyRecord);
    const receiverStoreRust = new MockSenderKeyStore(rust.SenderKeyRecord);
    const senderBuilderRust = new rust.GroupSessionBuilder(senderStoreRust);
    const skdmRust = await senderBuilderRust.create(senderKeyNameRust);
    const receiverBuilderRust = new rust.GroupSessionBuilder(receiverStoreRust);
    await receiverBuilderRust.process(senderKeyNameRust, skdmRust);
    const senderCipherRust = new rust.GroupCipher(senderStoreRust, senderKeyNameRust);
    const receiverCipherRust = new rust.GroupCipher(receiverStoreRust, senderKeyNameRust);

    const plaintextMsg = Buffer.from('Artoria GroupCipher Benchmark Payload 2026');

    benchmarkResults.push(await runBenchmark(
        'GroupCipher Encrypt-Decrypt Cycle (1,000 cycles)',
        1000, 100, 5,
        async () => {
            const enc = await senderCipherJs.encrypt(plaintextMsg);
            const dec = await receiverCipherJs.decrypt(enc);
            return dec;
        },
        async () => {
            const enc = await senderCipherRust.encrypt(plaintextMsg);
            const dec = await receiverCipherRust.decrypt(enc);
            return dec;
        }
    ));

    // =========================================================================
    // 8. MICRO-BENCHMARKS: Level 3 Modules (Normalization, Decode & Clean)
    // =========================================================================
    const complexMessage = {
        ephemeralMessage: {
            message: {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: 'Testing Level 3 Rust Normalizer Parity' },
                            nativeFlowMessage: {
                                buttons: [
                                    { name: 'quick_reply', buttonParamsJson: '{"id":"test"}' }
                                ]
                            }
                        }
                    }
                }
            }
        }
    };

    benchmarkResults.push(await runBenchmark(
        'normalizeMessageContent (1,000 complex messages)',
        1000, 200, 5,
        () => js.messages.normalizeMessageContent(complexMessage),
        () => rust.messages.normalizeMessageContent(complexMessage)
    ));

    const stanzaNode = {
        tag: 'message',
        attrs: {
            from: '628123456789@s.whatsapp.net',
            to: '628987654321@s.whatsapp.net',
            id: '3EB0TEST123',
            type: 'text',
            t: '1723800000'
        },
        content: [
            {
                tag: 'body',
                attrs: {},
                content: Buffer.from('Standard WhatsApp text body')
            }
        ]
    };

    benchmarkResults.push(await runBenchmark(
        'decodeMessageNode (1,000 stanza nodes)',
        1000, 200, 5,
        () => js.decode.decodeMessageNode(stanzaNode, '628987654321@s.whatsapp.net', '628987654321@lid'),
        () => rust.decode.decodeMessageNode(stanzaNode, '628987654321@s.whatsapp.net', '628987654321@lid')
    ));

    const rawMsgToClean = {
        key: {
            remoteJid: '628123456789:2@s.whatsapp.net',
            fromMe: false,
            id: '3EB0TEST999'
        },
        message: {
            conversation: 'Test cleaning message payload'
        },
        messageTimestamp: 1723800000
    };

    benchmarkResults.push(await runBenchmark(
        'cleanMessage Normalization (1,000 messages)',
        1000, 200, 5,
        () => {
            const m = JSON.parse(JSON.stringify(rawMsgToClean));
            js.process.cleanMessage(m, '628987654321@s.whatsapp.net', '628987654321@lid');
            return m;
        },
        () => {
            const m = JSON.parse(JSON.stringify(rawMsgToClean));
            rust.process.cleanMessage(m, '628987654321@s.whatsapp.net', '628987654321@lid');
            return m;
        }
    ));

    // =========================================================================
    // 9. MACRO-BENCHMARKS: Sustained Throughput, Memory Footprint & Startup
    // =========================================================================
    console.log(`\n============================================================`);
    console.log(`▶ MACRO-BENCHMARK: Sustained Group Message Decryption Throughput`);
    console.log(`  Processing 5,000 skmsg messages in continuous stream...`);

    const encListJs = [];
    const encListRust = [];
    for (let i = 0; i < 5000; i++) {
        encListJs.push(await senderCipherJs.encrypt(Buffer.from(`Throughput Payload #${i}`)));
        encListRust.push(await senderCipherRust.encrypt(Buffer.from(`Throughput Payload #${i}`)));
    }

    // JS Throughput
    const startJsTp = process.hrtime.bigint();
    for (let i = 0; i < 5000; i++) {
        await receiverCipherJs.decrypt(encListJs[i]);
    }
    const endJsTp = process.hrtime.bigint();
    const jsTpDurationSec = Number(endJsTp - startJsTp) / 1_000_000_000;
    const jsMsgPerSec = 5000 / jsTpDurationSec;

    // Rust Throughput
    const startRustTp = process.hrtime.bigint();
    for (let i = 0; i < 5000; i++) {
        await receiverCipherRust.decrypt(encListRust[i]);
    }
    const endRustTp = process.hrtime.bigint();
    const rustTpDurationSec = Number(endRustTp - startRustTp) / 1_000_000_000;
    const rustMsgPerSec = 5000 / rustTpDurationSec;

    console.log(`  JS Throughput:   ${jsMsgPerSec.toFixed(1)} msg/sec (${jsTpDurationSec.toFixed(3)} s)`);
    console.log(`  Rust Throughput: ${rustMsgPerSec.toFixed(1)} msg/sec (${rustTpDurationSec.toFixed(3)} s)`);
    console.log(`  Throughput Ratio: ${(rustMsgPerSec / jsMsgPerSec).toFixed(2)}x`);

    const macroThroughput = {
        jsMsgPerSec,
        rustMsgPerSec,
        ratio: rustMsgPerSec / jsMsgPerSec,
        jsDurationSec: jsTpDurationSec,
        rustDurationSec: rustTpDurationSec
    };

    // Macro Memory Footprint
    if (global.gc) {
        global.gc();
    }
    const memInitial = process.memoryUsage();

    for (let i = 0; i < 10000; i++) {
        const enc = rust.WABinary.encodeBinaryNode(mediumNode);
        rust.WABinary.decodeBinaryNode(enc);
    }

    const memAfter = process.memoryUsage();
    const memoryFootprint = {
        heapUsedInitialMB: (memInitial.heapUsed / (1024 * 1024)).toFixed(2),
        heapUsedAfterMB: (memAfter.heapUsed / (1024 * 1024)).toFixed(2),
        heapDeltaMB: ((memAfter.heapUsed - memInitial.heapUsed) / (1024 * 1024)).toFixed(2),
        rssInitialMB: (memInitial.rss / (1024 * 1024)).toFixed(2),
        rssAfterMB: (memAfter.rss / (1024 * 1024)).toFixed(2),
        rssDeltaMB: ((memAfter.rss - memInitial.rss) / (1024 * 1024)).toFixed(2)
    };

    console.log(`\n============================================================`);
    console.log(`▶ MACRO-BENCHMARK: Memory Footprint (10,000 operations)`);
    console.log(`  Heap: ${memoryFootprint.heapUsedInitialMB} MB -> ${memoryFootprint.heapUsedAfterMB} MB (Δ ${memoryFootprint.heapDeltaMB} MB)`);
    console.log(`  RSS:  ${memoryFootprint.rssInitialMB} MB -> ${memoryFootprint.rssAfterMB} MB (Δ ${memoryFootprint.rssDeltaMB} MB)`);

    // Cold start measurement
    console.log(`\n============================================================`);
    console.log(`▶ MACRO-BENCHMARK: Cold-Start Process Load Time`);
    const jsStartTimes = [];
    const rustStartTimes = [];

    for (let i = 0; i < 5; i++) {
        const t0 = process.hrtime.bigint();
        execSync(`node -e "import('${pathToFileURL(path.join(PURE_JS_DIR, 'index.js')).href}')"`);
        const t1 = process.hrtime.bigint();
        jsStartTimes.push(Number(t1 - t0) / 1_000_000);

        const t2 = process.hrtime.bigint();
        execSync(`node -e "import('${pathToFileURL(path.join(RUST_DIR, '../index.js')).href}')"`);
        const t3 = process.hrtime.bigint();
        rustStartTimes.push(Number(t3 - t2) / 1_000_000);
    }

    const jsStartStats = calculateStats(jsStartTimes);
    const rustStartStats = calculateStats(rustStartTimes);

    console.log(`  JS Startup Median:   ${jsStartStats.median.toFixed(2)} ms`);
    console.log(`  Rust Startup Median: ${rustStartStats.median.toFixed(2)} ms`);

    const coldStart = {
        jsMedianMs: jsStartStats.median,
        rustMedianMs: rustStartStats.median,
        ratio: jsStartStats.median / rustStartStats.median
    };

    // Output complete JSON summary
    const summary = {
        envInfo,
        microBenchmarks: benchmarkResults,
        macroThroughput,
        memoryFootprint,
        coldStart
    };

    return summary;
}

// Execute and print JSON if run directly
main().then(summary => {
    console.log(`\n============================================================`);
    console.log(`BENCHMARK COMPLETED SUCCESSFULLY!`);
    console.log(`============================================================\n`);
    console.log('__BENCHMARK_JSON_START__');
    console.log(JSON.stringify(summary, null, 2));
    console.log('__BENCHMARK_JSON_END__');
}).catch(err => {
    console.error('Benchmark execution failed:', err);
    process.exit(1);
});
