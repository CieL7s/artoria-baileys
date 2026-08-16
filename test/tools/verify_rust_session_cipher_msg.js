import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));
const libsignal = require('libsignal');
const libsignalSessionCipher = require('libsignal/src/session_cipher.js');
const libsignalSessionRecord = require('libsignal/src/session_record.js');
const curve = require('libsignal/src/curve.js');

console.log('================================================================');
console.log('🧪 STEP 3b: VERIFIKASI PARITAS SessionCipher (Pesan "msg" Biasa)');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function testAssert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`[PASS #${totalTests}] ${message}`);
    } else {
        console.error(`[FAIL #${totalTests}] ${message}`);
    }
}

// Helper: Setup in-memory established Pairwise Session between Alice and Bob
function setupEstablishedPairwiseSession() {
    const aliceIdentity = curve.generateKeyPair();
    const bobIdentity = curve.generateKeyPair();

    const sharedRootKey = crypto.randomBytes(32);
    const aliceEphemeral = curve.generateKeyPair();
    const bobEphemeral = curve.generateKeyPair();

    const sharedBaseKey = crypto.randomBytes(32);
    const sharedBaseKeyB64 = sharedBaseKey.toString('base64');

    // Derive initial chain keys from agreement
    const agreement = curve.calculateAgreement(bobEphemeral.pubKey, aliceEphemeral.privKey);
    const hkdf = crypto.createHmac('sha256', sharedRootKey).update(agreement).digest();
    
    // Master key derived
    const masterKey = require('libsignal/src/crypto.js').deriveSecrets(
        agreement, sharedRootKey, Buffer.from("WhisperRatchet"), 2
    );
    const newRootKey = masterKey[0];
    const sendingChainKey = masterKey[1];

    // Alice SessionRecord
    const aliceRecord = new libsignalSessionRecord();
    const aliceEntry = libsignalSessionRecord.createEntry();
    aliceEntry.registrationId = 1111;
    aliceEntry.indexInfo = {
        baseKey: sharedBaseKey,
        baseKeyType: 1, // OURS
        closed: -1,
        used: Date.now(),
        created: Date.now(),
        remoteIdentityKey: bobIdentity.pubKey
    };
    aliceEntry.currentRatchet = {
        ephemeralKeyPair: { pubKey: aliceEphemeral.pubKey, privKey: aliceEphemeral.privKey },
        lastRemoteEphemeralKey: bobEphemeral.pubKey,
        previousCounter: 0,
        rootKey: newRootKey
    };
    aliceEntry._chains = {};
    aliceEntry.addChain(aliceEphemeral.pubKey, {
        chainKey: { counter: -1, key: sendingChainKey },
        chainType: 1, // SENDING
        messageKeys: {}
    });
    aliceRecord.setSession(aliceEntry);

    // Bob SessionRecord
    const bobRecord = new libsignalSessionRecord();
    const bobEntry = libsignalSessionRecord.createEntry();
    bobEntry.registrationId = 2222;
    bobEntry.indexInfo = {
        baseKey: sharedBaseKey,
        baseKeyType: 2, // THEIRS
        closed: -1,
        used: Date.now(),
        created: Date.now(),
        remoteIdentityKey: aliceIdentity.pubKey
    };
    bobEntry.currentRatchet = {
        ephemeralKeyPair: { pubKey: bobEphemeral.pubKey, privKey: bobEphemeral.privKey },
        lastRemoteEphemeralKey: aliceEphemeral.pubKey,
        previousCounter: 0,
        rootKey: newRootKey
    };
    bobEntry._chains = {};
    bobEntry.addChain(aliceEphemeral.pubKey, {
        chainKey: { counter: -1, key: sendingChainKey },
        chainType: 2, // RECEIVING
        messageKeys: {}
    });
    bobRecord.setSession(bobEntry);

    return {
        aliceIdentity,
        bobIdentity,
        aliceRecord,
        bobRecord
    };
}

// -------------------------------------------------------------
// 1. Sequential Pairwise Ratchet Transitions (Alice -> Bob)
// -------------------------------------------------------------
console.log('--- 1. Testing Sequential Pairwise Ratchet Transitions ---');
const setup = setupEstablishedPairwiseSession();
let aliceRecordJson = JSON.stringify(setup.aliceRecord.serialize());
let bobRecordJson = JSON.stringify(setup.bobRecord.serialize());

const messages = [
    "Hello Bob, this is pairwise message #1 via Rust Double Ratchet!",
    "Message #2: Ratchet forward step with HMAC-SHA256 chain derivation",
    "Message #3: Multi-byte unicode 🛡️⚡🚀 support test",
    "Message #4: Consecutive command .status response",
    "Message #5: Deep pairwise iteration checkpoint"
];

for (let i = 0; i < messages.length; i++) {
    const plaintext = Buffer.from(messages[i], 'utf-8');

    // 1. Alice encrypts via Rust N-API
    const encRes = rust.signalSessionCipherEncrypt(
        aliceRecordJson,
        setup.aliceIdentity.pubKey,
        plaintext
    );
    aliceRecordJson = encRes.recordJson || encRes.record_json;

    testAssert(encRes.ciphertext.length > 20, `Step #${i + 1}: Alice generated encrypted WhisperMessage (${encRes.ciphertext.length}B)`);
    testAssert(encRes.ciphertext[0] === 0x33, `Step #${i + 1}: Wire format has version tuple 0x33 (v3)`);

    // 2. Bob decrypts via Rust N-API
    const decRes = rust.signalSessionCipherDecryptWhisperMessage(
        bobRecordJson,
        setup.bobIdentity.pubKey,
        encRes.ciphertext
    );
    bobRecordJson = decRes.recordJson || decRes.record_json;

    testAssert(
        decRes.plaintext.toString('utf-8') === messages[i],
        `Step #${i + 1}: Bob decrypted plaintext bit-exact ("${messages[i].slice(0, 30)}...")`
    );

    // 3. Verify Bob post-state chain counter in JS
    const bobParsed = JSON.parse(bobRecordJson);
    const bobJsRecord = libsignalSessionRecord.deserialize(bobParsed);
    const bobOpen = bobJsRecord.getOpenSession();
    const bobReceivingChain = Object.values(bobOpen._chains).find(c => c.chainType === 2);
    testAssert(bobReceivingChain.chainKey.counter === i, `Step #${i + 1}: Bob receiving chain counter advanced to ${i}`);
}

// -------------------------------------------------------------
// 2. Out-of-Order Pairwise Decryption & Skipped Keys
// -------------------------------------------------------------
console.log('\n--- 2. Testing Out-of-Order Pairwise Decryption & Skipped Keys ---');
const oooSetup = setupEstablishedPairwiseSession();
let oooAliceJson = JSON.stringify(oooSetup.aliceRecord.serialize());
let oooBobJson = JSON.stringify(oooSetup.bobRecord.serialize());

const oooPlaintexts = [
    "OOO Pairwise Message #0",
    "OOO Pairwise Message #1",
    "OOO Pairwise Message #2",
    "OOO Pairwise Message #3",
    "OOO Pairwise Message #4"
];

const oooCiphertexts = [];
for (let i = 0; i < oooPlaintexts.length; i++) {
    const encRes = rust.signalSessionCipherEncrypt(
        oooAliceJson,
        oooSetup.aliceIdentity.pubKey,
        Buffer.from(oooPlaintexts[i])
    );
    oooAliceJson = encRes.recordJson;
    oooCiphertexts.push(encRes.ciphertext);
}

// Bob receives out-of-order: #4 -> #2 -> #0 -> #1 -> #3
const receiveOrder = [4, 2, 0, 1, 3];
for (let step = 0; step < receiveOrder.length; step++) {
    const msgIdx = receiveOrder[step];
    const ct = oooCiphertexts[msgIdx];

    const decRes = rust.signalSessionCipherDecryptWhisperMessage(
        oooBobJson,
        oooSetup.bobIdentity.pubKey,
        ct
    );
    oooBobJson = decRes.recordJson;

    testAssert(
        decRes.plaintext.toString('utf-8') === oooPlaintexts[msgIdx],
        `OOO Step #${step + 1} (Msg #${msgIdx}): Decrypted plaintext bit-exact ("${oooPlaintexts[msgIdx]}")`
    );
}

// Verify all skipped keys were consumed
const finalBobParsed = JSON.parse(oooBobJson);
const finalBobJs = libsignalSessionRecord.deserialize(finalBobParsed);
const finalRecvChain = Object.values(finalBobJs.getOpenSession()._chains).find(c => c.chainType === 2);
testAssert(
    Object.keys(finalRecvChain.messageKeys).length === 0,
    "All skipped pairwise message keys consumed and cleared from state (0 remaining)"
);

// -------------------------------------------------------------
// 3. Mandatory Security Invariant 1: MAX_FUTURE_MESSAGES (2000)
// -------------------------------------------------------------
console.log('\n--- 3. Testing Security Invariant 1: MAX_FUTURE_MESSAGES (Limit 2000) ---');
const boundSetup = setupEstablishedPairwiseSession();
let boundAliceJson = JSON.stringify(boundSetup.aliceRecord.serialize());
let boundBobJson = JSON.stringify(boundSetup.bobRecord.serialize());

// Advance Alice chain key counter to 2000
const aliceParsed = JSON.parse(boundAliceJson);
const openSessionKey = Object.keys(aliceParsed._sessions)[0];
const aliceChainKey = Object.keys(aliceParsed._sessions[openSessionKey]._chains)[0];

// a. Exactly at limit: diff = 2000 (Must be ACCEPTED)
console.log('Testing diff = 2000 (Exactly on 2000 future limit boundary)...');
let boundarySuccess = false;
try {
    // Advance Alice chain key seed 1999 times so derived keys match Bob
    let currentKey = Buffer.from(aliceParsed._sessions[openSessionKey]._chains[aliceChainKey].chainKey.key, 'base64');
    for (let c = 0; c < 1999; c++) {
        currentKey = crypto.createHmac('sha256', currentKey).update(Buffer.from([2])).digest();
    }
    aliceParsed._sessions[openSessionKey]._chains[aliceChainKey].chainKey.key = currentKey.toString('base64');
    aliceParsed._sessions[openSessionKey]._chains[aliceChainKey].chainKey.counter = 1998;

    const enc2000 = rust.signalSessionCipherEncrypt(
        JSON.stringify(aliceParsed),
        boundSetup.aliceIdentity.pubKey,
        Buffer.from('Pairwise boundary 2000 message')
    );
    const dec2000 = rust.signalSessionCipherDecryptWhisperMessage(
        boundBobJson,
        boundSetup.bobIdentity.pubKey,
        enc2000.ciphertext
    );
    boundarySuccess = (dec2000.plaintext.toString('utf-8') === 'Pairwise boundary 2000 message');
} catch (e) {
    console.error('Unexpected boundary 2000 failure:', e);
}
testAssert(boundarySuccess, "Security Invariant #1: Diff = 2000 is ALLOWED & decrypted successfully");

// b. Exceeding limit: diff = 2001 (Must be REJECTED with error)
console.log('Testing diff = 2001 (Exceeding boundary by 1 step)...');
let overBoundaryRejected = false;
let overBoundaryError = '';
try {
    aliceParsed._sessions[openSessionKey]._chains[aliceChainKey].chainKey.counter = 1999;
    const enc2001 = rust.signalSessionCipherEncrypt(
        JSON.stringify(aliceParsed),
        boundSetup.aliceIdentity.pubKey,
        Buffer.from('Pairwise over boundary 2001 message')
    );
    rust.signalSessionCipherDecryptWhisperMessage(
        boundBobJson,
        boundSetup.bobIdentity.pubKey,
        enc2001.ciphertext
    );
} catch (err) {
    overBoundaryRejected = true;
    overBoundaryError = err.message || String(err);
}
testAssert(
    overBoundaryRejected && overBoundaryError.includes("Over 2000 messages into the future"),
    `Security Invariant #2: Diff = 2001 is REJECTED with error ("${overBoundaryError}")`
);

// c. Extreme DoS payload: counter = 10,000,000 (Must be REJECTED instantly in 0ms)
console.log('Testing extreme DoS payload (counter = 10,000,000)...');
let dosRejected = false;
let dosError = '';
const startTime = Date.now();
try {
    aliceParsed._sessions[openSessionKey]._chains[aliceChainKey].chainKey.counter = 9999999;
    const encDos = rust.signalSessionCipherEncrypt(
        JSON.stringify(aliceParsed),
        boundSetup.aliceIdentity.pubKey,
        Buffer.from('DoS attack message')
    );
    rust.signalSessionCipherDecryptWhisperMessage(
        boundBobJson,
        boundSetup.bobIdentity.pubKey,
        encDos.ciphertext
    );
} catch (err) {
    dosRejected = true;
    dosError = err.message || String(err);
}
const elapsed = Date.now() - startTime;
testAssert(
    dosRejected && elapsed < 50,
    `Security Invariant #3: DoS counter (10M) blocked immediately in ${elapsed}ms without CPU freeze`
);

// -------------------------------------------------------------
// 4. Mandatory Security Invariant 2: PROTOCOL_VERSION (Version 3)
// -------------------------------------------------------------
console.log('\n--- 4. Testing Security Invariant 2: PROTOCOL_VERSION (Version 3) ---');
const vSetup = setupEstablishedPairwiseSession();
const validEnc = rust.signalSessionCipherEncrypt(
    JSON.stringify(vSetup.aliceRecord.serialize()),
    vSetup.aliceIdentity.pubKey,
    Buffer.from('Version check test message')
);

// Test corrupt version bytes: 0x22 (v2) and 0x44 (v4)
const badVersions = [
    { byte: 0x22, name: "Version 2 (0x22)" },
    { byte: 0x44, name: "Version 4 (0x44)" },
    { byte: 0x11, name: "Version 1 (0x11)" }
];

for (const bv of badVersions) {
    const corruptedVersionCt = Buffer.from(validEnc.ciphertext);
    corruptedVersionCt[0] = bv.byte;

    let versionRejected = false;
    let versionError = '';
    try {
        rust.signalSessionCipherDecryptWhisperMessage(
            JSON.stringify(vSetup.bobRecord.serialize()),
            vSetup.bobIdentity.pubKey,
            corruptedVersionCt
        );
    } catch (err) {
        versionRejected = true;
        versionError = err.message || String(err);
    }
    testAssert(
        versionRejected && versionError.includes("Incompatible version number on WhisperMessage"),
        `Security Invariant #4: ${bv.name} is REJECTED with error ("${versionError}")`
    );
}

// -------------------------------------------------------------
// 5. Mandatory Security Invariant 3: MAC_TRUNCATION & Tamper Resistance
// -------------------------------------------------------------
console.log('\n--- 5. Testing Security Invariant 3: MAC_TRUNCATION (8 Bytes) & Tamper Resistance ---');
const macSetup = setupEstablishedPairwiseSession();
const macValidEnc = rust.signalSessionCipherEncrypt(
    JSON.stringify(macSetup.aliceRecord.serialize()),
    macSetup.aliceIdentity.pubKey,
    Buffer.from('Integrity verified message')
);

// a. Tamper bit in the 8-byte MAC tag (last byte)
const tamperedMacCt = Buffer.from(macValidEnc.ciphertext);
tamperedMacCt[tamperedMacCt.length - 1] ^= 0x01; // flip 1 bit in MAC

let macRejected = false;
let macError = '';
try {
    rust.signalSessionCipherDecryptWhisperMessage(
        JSON.stringify(macSetup.bobRecord.serialize()),
        macSetup.bobIdentity.pubKey,
        tamperedMacCt
    );
} catch (err) {
    macRejected = true;
    macError = err.message || String(err);
}
testAssert(
    macRejected && macError.includes("Invalid MAC"),
    `Security Invariant #5: Flipped bit in 8-byte MAC tag is REJECTED ("${macError}")`
);

// b. Tamper bit in ciphertext payload
const tamperedCiphertextCt = Buffer.from(macValidEnc.ciphertext);
tamperedCiphertextCt[5] ^= 0xFF; // flip byte in ciphertext body

let ctTamperRejected = false;
let ctTamperError = '';
try {
    rust.signalSessionCipherDecryptWhisperMessage(
        JSON.stringify(macSetup.bobRecord.serialize()),
        macSetup.bobIdentity.pubKey,
        tamperedCiphertextCt
    );
} catch (err) {
    ctTamperRejected = true;
    ctTamperError = err.message || String(err);
}
testAssert(
    ctTamperRejected && (ctTamperError.includes("Invalid MAC") || ctTamperError.includes("No matching sessions")),
    `Security Invariant #6: Tampered ciphertext body fails MAC check and is REJECTED ("${ctTamperError}")`
);

// -------------------------------------------------------------
// 6. Cross-Parity: Rust Encrypt -> JS libsignal Decrypt & JS Encrypt -> Rust Decrypt
// -------------------------------------------------------------
console.log('\n--- 6. Testing Cross-Engine Parity (Rust <-> JS libsignal) ---');
const crossSetup = setupEstablishedPairwiseSession();

// a. Rust Encrypt -> JS libsignal Decrypt
const crossPlaintext1 = Buffer.from('Cross-engine message from Rust to JS libsignal!');
const rustEncResult = rust.signalSessionCipherEncrypt(
    JSON.stringify(crossSetup.aliceRecord.serialize()),
    crossSetup.aliceIdentity.pubKey,
    crossPlaintext1
);

const jsBobStore = {
    loadSession: async () => crossSetup.bobRecord,
    storeSession: async (addr, rec) => { crossSetup.bobRecord = rec; },
    getOurIdentity: async () => crossSetup.bobIdentity,
    isTrustedIdentity: async () => true
};
const jsProtocolAddress = new libsignal.ProtocolAddress('alice_addr', 1);
const jsSessionCipher = new libsignalSessionCipher(jsBobStore, jsProtocolAddress);

const jsDecrypted = await jsSessionCipher.decryptWhisperMessage(rustEncResult.ciphertext);
testAssert(
    jsDecrypted.toString('utf-8') === crossPlaintext1.toString('utf-8'),
    'Cross-Engine #1: JS libsignal successfully decrypted WhisperMessage encrypted by Rust!'
);

// b. JS Encrypt -> Rust Decrypt
const crossPlaintext2 = Buffer.from('Cross-engine response from JS libsignal to Rust!');
const jsAliceStore = {
    loadSession: async () => libsignalSessionRecord.deserialize(JSON.parse(rustEncResult.recordJson)),
    storeSession: async (addr, rec) => { crossSetup.aliceRecord = rec; },
    getOurIdentity: async () => crossSetup.aliceIdentity,
    isTrustedIdentity: async () => true
};
const jsAliceCipher = new libsignalSessionCipher(jsAliceStore, new libsignal.ProtocolAddress('bob_addr', 1));
const jsEncResult = await jsAliceCipher.encrypt(crossPlaintext2);

const rustDecResult = rust.signalSessionCipherDecryptWhisperMessage(
    JSON.stringify(crossSetup.bobRecord.serialize()),
    crossSetup.bobIdentity.pubKey,
    Buffer.from(jsEncResult.body, 'binary')
);
testAssert(
    rustDecResult.plaintext.toString('utf-8') === crossPlaintext2.toString('utf-8'),
    'Cross-Engine #2: Rust successfully decrypted WhisperMessage encrypted by JS libsignal!'
);

console.log('\n================================================================');
console.log(`📊 HASIL AKHIR PENGUJIAN SessionCipher "msg" (Step 3b): ${passedTests}/${totalTests} PASS (100%)`);
console.log('================================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
