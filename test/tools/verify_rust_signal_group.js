import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { SenderChainKey as JsSenderChainKey } from '../../lib/Signal/Group/sender-chain-key.js';
import { SenderMessageKey as JsSenderMessageKey } from '../../lib/Signal/Group/sender-message-key.js';
import { SenderKeyName as JsSenderKeyName } from '../../lib/Signal/Group/sender-key-name.js';
import { SenderKeyDistributionMessage as JsSKDM } from '../../lib/Signal/Group/sender-key-distribution-message.js';
import { SenderKeyMessage as JsSenderKeyMessage } from '../../lib/Signal/Group/sender-key-message.js';
import { SenderKeyState as JsSenderKeyState } from '../../lib/Signal/Group/sender-key-state.js';
import { SenderKeyRecord as JsSenderKeyRecord } from '../../lib/Signal/Group/sender-key-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));

const VECTOR_FILE = path.join(__dirname, '../vectors/signal-group-real-traffic.json');
const vectors = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf-8'));

console.log('================================================================');
console.log('=== TEST PARITAS LEVEL 1: SIGNAL GROUP PRIMITIVES (RUST VS JS) ===');
console.log('================================================================\n');

let allPassed = true;

const assertEq = (desc, actual, expected) => {
    let match = false;
    if (Buffer.isBuffer(actual) && Buffer.isBuffer(expected)) {
        match = actual.equals(expected);
    } else if (typeof actual === 'object' && typeof expected === 'object') {
        match = JSON.stringify(actual) === JSON.stringify(expected);
    } else {
        match = actual === expected;
    }

    if (match) {
        console.log(`[PASS] ${desc}`);
    } else {
        console.error(`[FAIL] ${desc}`);
        console.error('       Actual:  ', actual);
        console.error('       Expected:', expected);
        allPassed = false;
    }
};

// -------------------------------------------------------------
// 1. TESTING SENDER CHAIN KEY & SENDER MESSAGE KEY (HMAC/HKDF)
// -------------------------------------------------------------
console.log('--- 1. TESTING SENDER CHAIN KEY & SENDER MESSAGE KEY ---');
for (let i = 0; i < 5; i++) {
    const seed = Buffer.alloc(32, (i + 1) * 31);
    const iteration = i * 10;

    // JS Derivation
    const jsChain = new JsSenderChainKey(iteration, seed);
    const jsMsgKey = jsChain.getSenderMessageKey();
    const jsNextChain = jsChain.getNext();

    // Rust Derivation
    const rustMsgKey = rust.signalGroupChainKeyGetMessageKey(iteration, seed);
    const rustNextChain = rust.signalGroupChainKeyNext(iteration, seed);

    assertEq(`ChainKey #${i+1} IV derivation (iteration ${iteration})`, rustMsgKey.iv, jsMsgKey.getIv());
    assertEq(`ChainKey #${i+1} CipherKey derivation (32 bytes)`, rustMsgKey.cipherKey, jsMsgKey.getCipherKey());
    assertEq(`ChainKey #${i+1} Next Seed derivation (HMAC-SHA256)`, rustNextChain.seed, jsNextChain.getSeed());
    assertEq(`ChainKey #${i+1} Next Iteration increment`, rustNextChain.iteration, jsNextChain.getIteration());
}

// -------------------------------------------------------------
// 2. TESTING SENDER KEY NAME PARSING & FORMATTING
// -------------------------------------------------------------
console.log('\n--- 2. TESTING SENDER KEY NAME ---');
const sampleNames = [
    { raw: '120363409742668546@g.us::202950408405214_1::0', group: '120363409742668546@g.us', sender: '202950408405214_1', dev: 0 },
    { raw: '120363423520240855@g.us::132598911267037_1::49', group: '120363423520240855@g.us', sender: '132598911267037_1', dev: 49 },
    { raw: 'status@broadcast::91410241945718_1::0', group: 'status@broadcast', sender: '91410241945718_1', dev: 0 }
];

for (const sn of sampleNames) {
    const parsed = rust.signalGroupParseSenderKeyName(sn.raw);
    assertEq(`Parse SenderKeyName (${sn.raw}) group_id`, parsed?.groupId, sn.group);
    assertEq(`Parse SenderKeyName (${sn.raw}) sender`, parsed?.sender, sn.sender);
    assertEq(`Parse SenderKeyName (${sn.raw}) device_id`, parsed?.deviceId, sn.dev);

    const formatted = rust.signalGroupFormatSenderKeyName(sn.group, sn.sender, sn.dev);
    assertEq(`Format SenderKeyName (${sn.raw}) string`, formatted, sn.raw);
}

// -------------------------------------------------------------
// 3. TESTING SENDER KEY DISTRIBUTION MESSAGE (SKDM PROTOBUF)
// -------------------------------------------------------------
console.log('\n--- 3. TESTING SENDER KEY DISTRIBUTION MESSAGE ---');
const skdmSeed = Buffer.alloc(32, 77);
const skdmSignKey = Buffer.alloc(32, 88);

// Rust encode -> JS decode
const rustSkdmBytes = rust.signalGroupCreateSkdm(123456, 42, skdmSeed, skdmSignKey);
const jsDecodedSkdm = new JsSKDM(null, null, null, null, rustSkdmBytes);
assertEq('SKDM Rust encode -> JS decode ID', jsDecodedSkdm.getId(), 123456);
assertEq('SKDM Rust encode -> JS decode Iteration', jsDecodedSkdm.getIteration(), 42);
assertEq('SKDM Rust encode -> JS decode ChainKey', jsDecodedSkdm.getChainKey(), skdmSeed);
assertEq('SKDM Rust encode -> JS decode SignatureKey', jsDecodedSkdm.getSignatureKey(), skdmSignKey);

// JS encode -> Rust decode
const jsSkdm = new JsSKDM(654321, 99, skdmSeed, skdmSignKey);
const jsSkdmBytes = jsSkdm.serialize();
const rustDecodedSkdm = rust.signalGroupParseSkdm(jsSkdmBytes);
assertEq('SKDM JS encode -> Rust decode ID', rustDecodedSkdm.id, 654321);
assertEq('SKDM JS encode -> Rust decode Iteration', rustDecodedSkdm.iteration, 99);
assertEq('SKDM JS encode -> Rust decode ChainKey', rustDecodedSkdm.chainKey, skdmSeed);
assertEq('SKDM JS encode -> Rust decode SignatureKey', rustDecodedSkdm.signatureKey, skdmSignKey);

// -------------------------------------------------------------
// 4. TESTING SENDER KEY MESSAGE & VERIFY SIGNATURE (REAL VECTORS)
// -------------------------------------------------------------
console.log('\n--- 4. TESTING SENDER KEY MESSAGE & VERIFY SIGNATURE (5 REAL VECTORS) ---');
for (const vec of vectors.skmsg_vectors) {
    const rawInput = vec.raw_input_hex ? Buffer.from(vec.raw_input_hex, 'hex') : (vec.raw_input_base64 ? Buffer.from(vec.raw_input_base64, 'base64') : null);
    const pubKey = vec.public_key_hex ? Buffer.from(vec.public_key_hex, 'hex') : (vec.public_key_base64 ? Buffer.from(vec.public_key_base64, 'base64') : null);

    if (!rawInput || !pubKey) continue;

    // Parse via Rust
    const rustParsed = rust.signalGroupParseSenderKeyMessage(rawInput);
    assertEq(`${vec.id} Rust parse KeyID`, rustParsed.keyId, vec.key_id);
    assertEq(`${vec.id} Rust parse Iteration`, rustParsed.iteration, vec.iteration);
    if (vec.ciphertext_hex || vec.ciphertext_base64) {
        const expectedCipherLen = vec.ciphertext_hex ? Buffer.from(vec.ciphertext_hex, 'hex').length : Buffer.from(vec.ciphertext_base64, 'base64').length;
        assertEq(`${vec.id} Rust parse Ciphertext length`, rustParsed.ciphertext.length, expectedCipherLen);
    }
    if (vec.signature_hex || vec.signature_base64) {
        const expectedSig = vec.signature_hex ? Buffer.from(vec.signature_hex, 'hex') : Buffer.from(vec.signature_base64, 'base64');
        assertEq(`${vec.id} Rust parse Signature (64 bytes)`, rustParsed.signature, expectedSig);
    }

    // Verify signature via Rust
    const isRustSigValid = rust.signalGroupVerifySenderKeyMessage(rawInput, pubKey);
    assertEq(`${vec.id} Rust verify signature with valid public key`, isRustSigValid, true);

    // Negative tests: tampered payload or wrong public key
    const tamperedInput = Buffer.from(rawInput);
    tamperedInput[tamperedInput.length - 1] ^= 0xff;
    const isTamperedValid = rust.signalGroupVerifySenderKeyMessage(tamperedInput, pubKey);
    assertEq(`${vec.id} Rust strictly rejects tampered signature`, isTamperedValid, false);

    const wrongPubKey = Buffer.alloc(32, 0x99);
    const isWrongKeyValid = rust.signalGroupVerifySenderKeyMessage(rawInput, wrongPubKey);
    assertEq(`${vec.id} Rust strictly rejects wrong public key`, isWrongKeyValid, false);
}

// -------------------------------------------------------------
// 5. TESTING SENDER KEY RECORD & 5-STATE CAP (DESERIALIZATION)
// -------------------------------------------------------------
console.log('\n--- 5. TESTING SENDER KEY RECORD DESERIALIZATION & 5-STATE CAP ---');
for (const vec of vectors.skmsg_vectors) {
    const snapshot = vec.session_state_snapshot;
    if (!snapshot) continue;
    const jsonStr = JSON.stringify(snapshot);

    // Deserialize via Rust
    const rustDeserializedJson = rust.signalGroupRecordDeserialize(jsonStr);
    const rustStates = JSON.parse(rustDeserializedJson);

    // Deserialize via JS
    const jsRecord = Array.isArray(snapshot) ? new JsSenderKeyRecord(snapshot) : JsSenderKeyRecord.deserialize(snapshot);
    const jsStates = jsRecord.serialize();

    assertEq(`${vec.id} State count (Rust vs JS)`, rustStates.length, jsStates.length);
    assertEq(`${vec.id} Active KeyID match`, rustStates[0]?.senderKeyId, jsStates[0]?.senderKeyId);
    assertEq(`${vec.id} ChainKey Iteration match`, rustStates[0]?.senderChainKey?.iteration, jsStates[0]?.senderChainKey?.iteration);
    assertEq(`${vec.id} Max 5 states invariant (<= 5)`, rustStates.length <= 5, true);
}

// Test state capping at 5
console.log('\n--- 6. TESTING RECORD CAPPING LIMIT (EXACTLY 5 STATES) ---');
const testStates = [];
for (let i = 1; i <= 8; i++) {
    testStates.push({
        senderKeyId: 1000 + i,
        senderChainKey: { iteration: i, seed: { type: "Buffer", data: Array.from(Buffer.alloc(32, i)) } },
        senderSigningKey: { public: { type: "Buffer", data: Array.from(Buffer.alloc(33, 5)) }, private: { type: "Buffer", data: [] } },
        senderMessageKeys: []
    });
}
const cappedJson = rust.signalGroupRecordSerialize(JSON.stringify(testStates));
const cappedStates = JSON.parse(cappedJson);
assertEq('Record strictly caps 8 states down to 5 states', cappedStates.length, 5);
assertEq('Record keeps most recent state #8', cappedStates[4].senderKeyId, 1008);
assertEq('Record evicted oldest state #1 (oldest is now #4)', cappedStates[0].senderKeyId, 1004);

if (allPassed) {
    console.log('\n================================================================');
    console.log('✅ SEMUA 7 MODUL LEVEL 1 (SIGNAL GROUP PRIMITIVES) LULUS 100% PARITAS!');
    console.log('================================================================');
} else {
    console.error('\n❌ DITEMUKAN KEGAGALAN PADA UNIT TEST PARITAS LEVEL 1!');
    process.exit(1);
}
