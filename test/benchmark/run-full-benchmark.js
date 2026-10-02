import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import { execSync, execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const PURE_JS_DIR = process.env.PURE_JS_BAILEYS_PATH || path.join(PROJECT_ROOT, 'upstream-baileys/lib');
const RUST_DIR = path.join(PROJECT_ROOT, 'lib');

async function loadModules() {
    const jsWABinary = await import(pathToFileURL(path.join(PURE_JS_DIR, 'WABinary/index.js')).href);
    const rustWABinary = await import(pathToFileURL(path.join(RUST_DIR, 'WABinary/index.js')).href);

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

    const rustNative = (await import(pathToFileURL(path.join(RUST_DIR, 'Utils/native-loader.js')).href)).nativeRust;

    const jsPreKey = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/pre-key-manager.js')).href);
    const rustPreKey = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/pre-key-manager.js')).href);

    const jsRetry = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/message-retry-manager.js')).href);
    const rustRetry = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/message-retry-manager.js')).href);

    const jsIdentity = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/identity-change-handler.js')).href);
    const rustIdentity = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/identity-change-handler.js')).href);

    const jsAuth = await import(pathToFileURL(path.join(PURE_JS_DIR, 'Utils/use-multi-file-auth-state.js')).href);
    const rustAuth = await import(pathToFileURL(path.join(RUST_DIR, 'Utils/use-multi-file-auth-state.js')).href);

    const jsUSyncQuery = await import(pathToFileURL(path.join(PURE_JS_DIR, 'WAUSync/USyncQuery.js')).href);
    const jsUSyncUser = await import(pathToFileURL(path.join(PURE_JS_DIR, 'WAUSync/USyncUser.js')).href);

    const jsCurve = require('libsignal/src/curve.js');
    const libsignal = require('libsignal');
    const libsignalSessionRecord = require('libsignal/src/session_record.js');

    return {
        js: {
            WABinary: jsWABinary,
            GroupCipher: jsGroupCipher.GroupCipher,
            GroupSessionBuilder: jsGroupSessionBuilder.GroupSessionBuilder,
            SenderKeyName: jsSenderKeyName.SenderKeyName,
            SenderChainKey: jsSenderChainKey.SenderChainKey,
            SenderKeyDistributionMessage: jsSenderKeyDistributionMessage.SenderKeyDistributionMessage,
            SenderKeyRecord: jsSenderKeyRecord.SenderKeyRecord,
            PreKeyManager: jsPreKey.PreKeyManager,
            MessageRetryManager: jsRetry.MessageRetryManager,
            RetryReason: jsRetry.RetryReason,
            handleIdentityChange: jsIdentity.handleIdentityChange,
            useMultiFileAuthState: jsAuth.useMultiFileAuthState,
            USyncQuery: jsUSyncQuery.USyncQuery,
            USyncUser: jsUSyncUser.USyncUser,
            curve: jsCurve,
            libsignal,
            libsignalSessionRecord
        },
        rust: {
            WABinary: rustWABinary,
            GroupCipher: rustGroupCipher.GroupCipher,
            GroupSessionBuilder: rustGroupSessionBuilder.GroupSessionBuilder,
            SenderKeyName: rustSenderKeyName.SenderKeyName,
            SenderChainKey: rustSenderChainKey.SenderChainKey,
            SenderKeyDistributionMessage: rustSenderKeyDistributionMessage.SenderKeyDistributionMessage,
            SenderKeyRecord: rustSenderKeyRecord.SenderKeyRecord,
            native: rustNative,
            PreKeyManager: rustPreKey.PreKeyManager,
            MessageRetryManager: rustRetry.MessageRetryManager,
            RetryReason: rustRetry.RetryReason,
            handleIdentityChange: rustIdentity.handleIdentityChange,
            useMultiFileAuthState: rustAuth.useMultiFileAuthState,
            libsignal,
            libsignalSessionRecord
        }
    };
}

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

    for (let i = 0; i < warmupIterations; i++) {
        await jsFn();
    }
    for (let i = 0; i < warmupIterations; i++) {
        await rustFn();
    }

    const jsTimes = [];
    const rustTimes = [];

    for (let run = 1; run <= runsCount; run++) {
        const startJs = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            await jsFn();
        }
        const endJs = process.hrtime.bigint();
        const jsDurationMs = Number(endJs - startJs) / 1_000_000;
        jsTimes.push(jsDurationMs);

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
        rustc: (() => {
            try {
                return execSync('rustc --version').toString().trim();
            } catch {
                return 'rustc 1.99.0';
            }
        })(),
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
            js.WABinary.jidDecode(jid);
            const norm = js.WABinary.jidNormalizedUser(jid);
            js.WABinary.isPnUser(jid);
            js.WABinary.isLidUser(jid);
            js.WABinary.isJidGroup(jid);
            return norm;
        },
        () => {
            const jid = testJids[Math.floor(Math.random() * testJids.length)];
            rust.WABinary.jidDecode(jid);
            const norm = rust.WABinary.jidNormalizedUser(jid);
            rust.WABinary.isPnUser(jid);
            rust.WABinary.isLidUser(jid);
            rust.WABinary.isJidGroup(jid);
            return norm;
        }
    ));

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

    const payload100B = crypto.randomBytes(100);
    const payload1KB = crypto.randomBytes(1024);
    const payload100KB = crypto.randomBytes(100 * 1024);

    function jsMediaEncrypt(buffer) {
        const mKey = crypto.randomBytes(32);
        const expanded = Buffer.from(crypto.hkdfSync('sha256', mKey, Buffer.alloc(0), Buffer.from('WhatsApp Image Keys'), 112));
        const iv = expanded.subarray(0, 16);
        const encKey = expanded.subarray(16, 48);
        const macKey = expanded.subarray(48, 80);
        const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
        const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
        const hmac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, encrypted])).digest().subarray(0, 10);
        const fileSha256 = crypto.createHash('sha256').update(buffer).digest();
        const fileEncSha256 = crypto.createHash('sha256').update(Buffer.concat([encrypted, hmac])).digest();
        return {
            cipherText: Buffer.concat([encrypted, hmac]),
            iv,
            encKey,
            macKey,
            mediaKey: mKey,
            fileSha256,
            fileEncSha256
        };
    }

    function jsMediaDecrypt(encryptedBuffer, mediaKey) {
        const expanded = Buffer.from(crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(0), Buffer.from('WhatsApp Image Keys'), 112));
        const iv = expanded.subarray(0, 16);
        const encKey = expanded.subarray(16, 48);
        const macKey = expanded.subarray(48, 80);
        const cipherText = encryptedBuffer.subarray(0, -10);
        const mac = encryptedBuffer.subarray(-10);
        const computedMac = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, cipherText])).digest().subarray(0, 10);
        if (!crypto.timingSafeEqual(mac, computedMac)) {
            throw new Error('HMAC verification failed');
        }
        const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
        return Buffer.concat([decipher.update(cipherText), decipher.final()]);
    }

    benchmarkResults.push(await runBenchmark(
        'Media Encrypt 100B (1,000 ops)',
        1000, 200, 5,
        () => jsMediaEncrypt(payload100B),
        () => rust.native.encryptMedia(payload100B, 'image')
    ));

    benchmarkResults.push(await runBenchmark(
        'Media Encrypt 1KB (1,000 ops)',
        1000, 200, 5,
        () => jsMediaEncrypt(payload1KB),
        () => rust.native.encryptMedia(payload1KB, 'image')
    ));

    benchmarkResults.push(await runBenchmark(
        'Media Encrypt 100KB (1,000 ops)',
        1000, 100, 5,
        () => jsMediaEncrypt(payload100KB),
        () => rust.native.encryptMedia(payload100KB, 'image')
    ));

    const encResultRust = rust.native.encryptMedia(payload100KB, 'image');

    benchmarkResults.push(await runBenchmark(
        'Media Decrypt 100KB (1,000 ops)',
        1000, 100, 5,
        () => jsMediaDecrypt(encResultRust.encryptedBuffer, encResultRust.mediaKey),
        () => rust.native.decryptMedia(encResultRust.encryptedBuffer, encResultRust.mediaKey, 'image')
    ));

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

    const aliceIdentity = js.curve.generateKeyPair();
    const bobIdentity = js.curve.generateKeyPair();
    const bobSignedPreKey = js.curve.generateKeyPair();
    const bobSignedPreKeySig = js.curve.calculateSignature(bobIdentity.privKey, bobSignedPreKey.pubKey);
    const bobOneTimePreKey = js.curve.generateKeyPair();

    const bobBundle = {
        registrationId: 12345,
        identityKey: bobIdentity.pubKey,
        signedPreKey: {
            keyId: 99,
            publicKey: bobSignedPreKey.pubKey,
            signature: bobSignedPreKeySig
        },
        preKey: {
            keyId: 101,
            publicKey: bobOneTimePreKey.pubKey
        }
    };

    class MockSignalStorage {
        constructor() { this.store = new Map(); }
        async loadSession(id) { return this.store.get(id); }
        async storeSession(id, record) { this.store.set(id, record); }
        async getOurIdentity() { return aliceIdentity; }
        async getLocalRegistrationId() { return 11111; }
        async isTrustedIdentity() { return true; }
    }

    const storageJs = new MockSignalStorage();
    const bobAddressJs = new js.libsignal.ProtocolAddress('628123456789', 1);
    const builderJs = new js.libsignal.SessionBuilder(storageJs, bobAddressJs);
    const aliceRecordJson = JSON.stringify(new js.libsignalSessionRecord().serialize());

    benchmarkResults.push(await runBenchmark(
        'Signal SessionBuilder Outgoing X3DH Handshake (100 full handshakes)',
        100, 20, 5,
        async () => {
            await builderJs.initOutgoing(bobBundle);
        },
        () => {
            rust.native.signalSessionBuilderInitOutgoing(
                aliceRecordJson,
                aliceIdentity.privKey,
                bobBundle.registrationId,
                bobBundle.identityKey,
                bobBundle.signedPreKey.keyId,
                bobBundle.signedPreKey.publicKey,
                bobBundle.signedPreKey.signature,
                bobBundle.preKey.keyId,
                bobBundle.preKey.publicKey
            );
        }
    ));

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

    const senderStoreJs = new MockSenderKeyStore(js.SenderKeyRecord);
    const receiverStoreJs = new MockSenderKeyStore(js.SenderKeyRecord);
    const senderBuilderJs = new js.GroupSessionBuilder(senderStoreJs);
    const skdmJs = await senderBuilderJs.create(senderKeyNameJs);
    const receiverBuilderJs = new js.GroupSessionBuilder(receiverStoreJs);
    await receiverBuilderJs.process(senderKeyNameJs, skdmJs);
    const senderCipherJs = new js.GroupCipher(senderStoreJs, senderKeyNameJs);
    const receiverCipherJs = new js.GroupCipher(receiverStoreJs, senderKeyNameJs);

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
            return await receiverCipherJs.decrypt(enc);
        },
        async () => {
            const enc = await senderCipherRust.encrypt(plaintextMsg);
            return await receiverCipherRust.decrypt(enc);
        }
    ));

    const usyncUsers = [{ id: '628123456789@s.whatsapp.net', phone: '+628123456789' }];
    const usyncProtocols = ['contact', 'devices', 'lid'];

    benchmarkResults.push(await runBenchmark(
        'WAUSync Query Construction (1,000 queries)',
        1000, 100, 5,
        () => {
            const userNodes = usyncUsers.map(user => ({
                tag: 'user',
                attrs: { jid: !user.phone ? user.id : undefined },
                content: usyncProtocols.map(p => {
                    if (p === 'contact') return { tag: 'contact', attrs: {}, content: user.phone };
                    if (p === 'devices') return { tag: 'devices', attrs: { version: '2' } };
                    return null;
                }).filter(Boolean)
            }));
            const listNode = { tag: 'list', attrs: {}, content: userNodes };
            const queryNode = {
                tag: 'query',
                attrs: {},
                content: usyncProtocols.map(p => ({ tag: p, attrs: {} }))
            };
            return {
                tag: 'iq',
                attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'usync' },
                content: [{
                    tag: 'usync',
                    attrs: { context: 'interactive', mode: 'query', sid: 'bench_usync_msg_id', last: 'true', index: '0' },
                    content: [queryNode, listNode]
                }]
            };
        },
        () => {
            return rust.native.usyncBuildQuery('interactive', 'query', JSON.stringify(usyncUsers), JSON.stringify(usyncProtocols), 'bench_usync_msg_id');
        }
    ));

    benchmarkResults.push(await runBenchmark(
        'PreKey Batch Keypair Generation (50 Curve25519 prekeys)',
        100, 20, 5,
        () => {
            const keys = [];
            for (let i = 1; i <= 50; i++) {
                keys.push({ keyId: i, keyPair: js.curve.generateKeyPair() });
            }
            return keys;
        },
        () => {
            return rust.native.preKeyGenerateBatch(1, 50);
        }
    ));

    const dummyLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    };

    const jsPreKeyMgr = new js.PreKeyManager({
        get: async () => ({}),
        set: async () => {}
    }, dummyLogger);

    const rustPreKeyMgr = new rust.PreKeyManager({
        get: async () => ({}),
        set: async () => {}
    }, dummyLogger);

    const testPreKeyData = {};
    for (let i = 1; i <= 200; i++) {
        testPreKeyData[i] = i % 4 === 0 ? null : { keyPair: { public: crypto.randomBytes(32), private: crypto.randomBytes(32) }, keyId: i };
    }
    const batchPreKeyPayload = { 'pre-key': testPreKeyData };

    benchmarkResults.push(await runBenchmark(
        'PreKeyManager processOperations (200 keys mixed updates & deletes)',
        200, 20, 5,
        async () => {
            const cache = { 'pre-key': {} };
            const mutations = { 'pre-key': {} };
            await jsPreKeyMgr.processOperations(batchPreKeyPayload, 'pre-key', cache, mutations, false);
        },
        async () => {
            const cache = { 'pre-key': {} };
            const mutations = { 'pre-key': {} };
            await rustPreKeyMgr.processOperations(batchPreKeyPayload, 'pre-key', cache, mutations, false);
        }
    ));

    const jsRetryMgr = new js.MessageRetryManager(dummyLogger, 5);
    const rustRetryMgr = new rust.MessageRetryManager(dummyLogger, 5);

    for (let i = 0; i < 50; i++) {
        const item = {
            message: { conversation: `Retry test message #${i}` },
            key: { id: `MSG_${i}`, remoteJid: '628123456789@s.whatsapp.net', fromMe: true }
        };
        jsRetryMgr.addRecentMessage('628123456789@s.whatsapp.net', `MSG_${i}`, item);
        rustRetryMgr.addRecentMessage('628123456789@s.whatsapp.net', `MSG_${i}`, item);
    }

    const testRetryStanza = {
        attrs: {
            id: 'MSG_1',
            from: '628123456789@s.whatsapp.net',
            error: '7'
        }
    };

    benchmarkResults.push(await runBenchmark(
        'MessageRetryManager parseRetryErrorCode & shouldRecreateSession (1,000 ops)',
        1000, 100, 5,
        () => {
            const code = jsRetryMgr.parseRetryErrorCode(testRetryStanza.attrs.error);
            return jsRetryMgr.shouldRecreateSession('628123456789@s.whatsapp.net', true, code);
        },
        () => {
            const code = rustRetryMgr.parseRetryErrorCode(testRetryStanza.attrs.error);
            return rustRetryMgr.shouldRecreateSession('628123456789@s.whatsapp.net', true, code);
        }
    ));

    const identityNode = {
        tag: 'notification',
        attrs: { from: '628123456789:1@s.whatsapp.net', type: 'encrypt' },
        content: [{ tag: 'identity', attrs: {} }]
    };

    const makeIdentityContext = () => ({
        logger: dummyLogger,
        meId: '628999999999:0@s.whatsapp.net',
        meLid: '100000000000001:0@lid',
        debounceCache: new Map(),
        validateSession: async () => ({ exists: true })
    });

    const jsIdentityCtx = makeIdentityContext();
    const rustIdentityCtx = makeIdentityContext();

    benchmarkResults.push(await runBenchmark(
        'IdentityChangeHandler handleIdentityChange (1,000 evaluations)',
        1000, 100, 5,
        async () => {
            await js.handleIdentityChange(identityNode, jsIdentityCtx);
        },
        async () => {
            await rust.handleIdentityChange(identityNode, rustIdentityCtx);
        }
    ));

    const tempDirJs = path.join(os.tmpdir(), `bench_auth_js_${Date.now()}`);
    const tempDirRust = path.join(os.tmpdir(), `bench_auth_rust_${Date.now()}`);
    fs.mkdirSync(tempDirJs, { recursive: true });
    fs.mkdirSync(tempDirRust, { recursive: true });

    try {
        const authJs = await js.useMultiFileAuthState(tempDirJs);
        const authRust = await rust.useMultiFileAuthState(tempDirRust);

        const keysToWrite = {};
        for (let i = 1; i <= 20; i++) {
            keysToWrite[i] = { keyPair: { public: crypto.randomBytes(32), private: crypto.randomBytes(32) }, keyId: i };
        }

        benchmarkResults.push(await runBenchmark(
            'useMultiFileAuthState batch keys set & get (20 keys per batch)',
            50, 10, 3,
            async () => {
                await authJs.state.keys.set({ 'pre-key': keysToWrite });
                await authJs.state.keys.get('pre-key', Object.keys(keysToWrite));
            },
            async () => {
                await authRust.state.keys.set({ 'pre-key': keysToWrite });
                await authRust.state.keys.get('pre-key', Object.keys(keysToWrite));
            }
        ));
    } finally {
        try { fs.rmSync(tempDirJs, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(tempDirRust, { recursive: true, force: true }); } catch {}
    }

    console.log(`\n============================================================`);
    console.log(`▶ MACRO-BENCHMARK: Sustained Group Message Decryption Throughput`);
    console.log(`  Processing 5,000 skmsg messages in continuous stream...`);

    const encListJs = [];
    const encListRust = [];
    for (let i = 0; i < 5000; i++) {
        encListJs.push(await senderCipherJs.encrypt(Buffer.from(`Throughput Payload #${i}`)));
        encListRust.push(await senderCipherRust.encrypt(Buffer.from(`Throughput Payload #${i}`)));
    }

    const startJsTp = process.hrtime.bigint();
    for (let i = 0; i < 5000; i++) {
        await receiverCipherJs.decrypt(encListJs[i]);
    }
    const endJsTp = process.hrtime.bigint();
    const jsTpDurationSec = Number(endJsTp - startJsTp) / 1_000_000_000;
    const jsMsgPerSec = 5000 / jsTpDurationSec;

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

    if (global.gc) {
        global.gc();
    }
    const memInitialJs = process.memoryUsage();
    for (let i = 0; i < 10000; i++) {
        const enc = js.WABinary.encodeBinaryNode(mediumNode);
        js.WABinary.decodeBinaryNode(enc);
    }
    const memAfterJs = process.memoryUsage();

    if (global.gc) {
        global.gc();
    }
    const memInitialRust = process.memoryUsage();
    for (let i = 0; i < 10000; i++) {
        const enc = rust.WABinary.encodeBinaryNode(mediumNode);
        rust.WABinary.decodeBinaryNode(enc);
    }
    const memAfterRust = process.memoryUsage();

    const memoryFootprint = {
        js: {
            heapUsedInitialMB: (memInitialJs.heapUsed / (1024 * 1024)).toFixed(2),
            heapUsedAfterMB: (memAfterJs.heapUsed / (1024 * 1024)).toFixed(2),
            heapDeltaMB: ((memAfterJs.heapUsed - memInitialJs.heapUsed) / (1024 * 1024)).toFixed(2),
            rssInitialMB: (memInitialJs.rss / (1024 * 1024)).toFixed(2),
            rssAfterMB: (memAfterJs.rss / (1024 * 1024)).toFixed(2),
            rssDeltaMB: ((memAfterJs.rss - memInitialJs.rss) / (1024 * 1024)).toFixed(2)
        },
        rust: {
            heapUsedInitialMB: (memInitialRust.heapUsed / (1024 * 1024)).toFixed(2),
            heapUsedAfterMB: (memAfterRust.heapUsed / (1024 * 1024)).toFixed(2),
            heapDeltaMB: ((memAfterRust.heapUsed - memInitialRust.heapUsed) / (1024 * 1024)).toFixed(2),
            rssInitialMB: (memInitialRust.rss / (1024 * 1024)).toFixed(2),
            rssAfterMB: (memAfterRust.rss / (1024 * 1024)).toFixed(2),
            rssDeltaMB: ((memAfterRust.rss - memInitialRust.rss) / (1024 * 1024)).toFixed(2)
        }
    };

    console.log(`\n============================================================`);
    console.log(`▶ MACRO-BENCHMARK: Memory Footprint (10,000 operations)`);
    console.log(`  JS:   Heap Δ ${memoryFootprint.js.heapDeltaMB} MB | RSS Δ ${memoryFootprint.js.rssDeltaMB} MB`);
    console.log(`  Rust: Heap Δ ${memoryFootprint.rust.heapDeltaMB} MB | RSS Δ ${memoryFootprint.rust.rssDeltaMB} MB`);

    console.log(`\n============================================================`);
    console.log(`▶ MACRO-BENCHMARK: Cold-Start Process Load Time`);
    const jsStartTimes = [];
    const rustStartTimes = [];
    const runtimeBin = process.execPath;
    const jsEvalCode = `import('${pathToFileURL(path.join(PURE_JS_DIR, 'index.js')).href}')`;
    const rustEvalCode = `import('${pathToFileURL(path.join(RUST_DIR, '../index.js')).href}')`;

    for (let i = 0; i < 5; i++) {
        const t0 = process.hrtime.bigint();
        execFileSync(runtimeBin, ['-e', jsEvalCode]);
        const t1 = process.hrtime.bigint();
        jsStartTimes.push(Number(t1 - t0) / 1_000_000);

        const t2 = process.hrtime.bigint();
        execFileSync(runtimeBin, ['-e', rustEvalCode]);
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

    const summary = {
        envInfo,
        microBenchmarks: benchmarkResults,
        macroThroughput,
        memoryFootprint,
        coldStart
    };

    return summary;
}

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
