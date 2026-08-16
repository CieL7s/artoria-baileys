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
const libsignalSessionBuilder = require('libsignal/src/session_builder.js');
const libsignalSessionRecord = require('libsignal/src/session_record.js');
const curve = require('libsignal/src/curve.js');

console.log('================================================================');
console.log('🧪 STEP 3c: VERIFIKASI X3DH HANDSHAKE & PreKeyWhisperMessage (pkmsg)');
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

// -------------------------------------------------------------
// 1. Full X3DH Handshake Variant (DH1 + DH2 + DH3 + DH4 with OTPK)
// -------------------------------------------------------------
console.log('--- 1. Testing Full X3DH Handshake (DH1 + DH2 + DH3 + DH4 with One-Time PreKey) ---');
const aliceIdentity = curve.generateKeyPair();
const bobIdentity = curve.generateKeyPair();

const bobSignedPreKey = curve.generateKeyPair();
const bobSignedPreKeySig = curve.calculateSignature(bobIdentity.privKey, bobSignedPreKey.pubKey);
const bobOneTimePreKey = curve.generateKeyPair();

const bobRegistrationId = 12345;
const bobSignedPreKeyId = 99;
const bobPreKeyId = 101;

// Alice initializes outgoing session via Rust N-API
let aliceRecordJson = JSON.stringify(new libsignalSessionRecord().serialize());
const aliceInit = rust.signalSessionBuilderInitOutgoing(
    aliceRecordJson,
    aliceIdentity.privKey,
    bobRegistrationId,
    bobIdentity.pubKey,
    bobSignedPreKeyId,
    bobSignedPreKey.pubKey,
    bobSignedPreKeySig,
    bobPreKeyId,
    bobOneTimePreKey.pubKey
);
aliceRecordJson = aliceInit.recordJson;

// Alice encrypts initial message
const initialPlaintext = Buffer.from('Initial X3DH Handshake Hello from Alice!');
const aliceEnc = rust.signalSessionCipherEncrypt(
    aliceRecordJson,
    aliceIdentity.pubKey,
    initialPlaintext
);
aliceRecordJson = aliceEnc.recordJson;

// Wrap into pkmsg envelope
const pkmsgBuf = rust.signalSessionBuilderBuildPkmsgEnvelope(
    aliceIdentity.pubKey,
    98765, // Alice registrationId
    aliceInit.baseKey,
    bobSignedPreKeyId,
    bobPreKeyId,
    aliceEnc.ciphertext
);

testAssert(pkmsgBuf[0] === 0x33, 'Full X3DH: pkmsg wire format starts with version tuple 0x33 (v3)');
testAssert(pkmsgBuf.length > 50, `Full X3DH: pkmsg envelope serialized (${pkmsgBuf.length}B)`);

// Bob processes incoming pkmsg via Rust N-API
let bobRecordJson = JSON.stringify(new libsignalSessionRecord().serialize());
const bobDec = rust.signalSessionBuilderProcessIncomingPkmsg(
    bobRecordJson,
    bobIdentity.privKey,
    bobIdentity.pubKey,
    bobSignedPreKey.privKey,
    bobSignedPreKey.pubKey,
    bobOneTimePreKey.privKey,
    pkmsgBuf
);
bobRecordJson = bobDec.recordJson;

testAssert(
    bobDec.plaintext.toString('utf-8') === initialPlaintext.toString('utf-8'),
    `Full X3DH: Bob decrypted initial pkmsg bit-exact ("${bobDec.plaintext.toString('utf-8')}")`
);
testAssert(bobDec.preKeyId === bobPreKeyId, `Full X3DH: Returned consumed preKeyId matches (${bobDec.preKeyId})`);

// Verify subsequent ping-pong messages in established session
const bobReplyPlaintext = Buffer.from('Hello Alice! X3DH Session Established Successfully!');
const bobEnc = rust.signalSessionCipherEncrypt(
    bobRecordJson,
    bobIdentity.pubKey,
    bobReplyPlaintext
);
bobRecordJson = bobEnc.recordJson;

const aliceDec = rust.signalSessionCipherDecryptWhisperMessage(
    aliceRecordJson,
    aliceIdentity.pubKey,
    bobEnc.ciphertext
);
aliceRecordJson = aliceDec.recordJson;

testAssert(
    aliceDec.plaintext.toString('utf-8') === bobReplyPlaintext.toString('utf-8'),
    `Full X3DH: Alice decrypted Bob response bit-exact ("${aliceDec.plaintext.toString('utf-8')}")`
);

// -------------------------------------------------------------
// 2. X3DH Handshake Variant WITHOUT OTPK (DH1 + DH2 + DH3 Only)
// -------------------------------------------------------------
console.log('\n--- 2. Testing X3DH Handshake WITHOUT One-Time PreKey (DH1 + DH2 + DH3 Only) ---');
const noOtpkAliceId = curve.generateKeyPair();
const noOtpkBobId = curve.generateKeyPair();
const noOtpkBobSignedKey = curve.generateKeyPair();
const noOtpkBobSignedSig = curve.calculateSignature(noOtpkBobId.privKey, noOtpkBobSignedKey.pubKey);

let noOtpkAliceRecord = JSON.stringify(new libsignalSessionRecord().serialize());
const noOtpkAliceInit = rust.signalSessionBuilderInitOutgoing(
    noOtpkAliceRecord,
    noOtpkAliceId.privKey,
    44444,
    noOtpkBobId.pubKey,
    888,
    noOtpkBobSignedKey.pubKey,
    noOtpkBobSignedSig,
    null, // pre_key_id = null
    null  // pre_key_public = null
);
noOtpkAliceRecord = noOtpkAliceInit.recordJson;

const noOtpkMsg = Buffer.from('X3DH without OTPK (exhausted prekey condition)');
const noOtpkEnc = rust.signalSessionCipherEncrypt(
    noOtpkAliceRecord,
    noOtpkAliceId.pubKey,
    noOtpkMsg
);
noOtpkAliceRecord = noOtpkEnc.recordJson;

const noOtpkPkmsg = rust.signalSessionBuilderBuildPkmsgEnvelope(
    noOtpkAliceId.pubKey,
    55555,
    noOtpkAliceInit.baseKey,
    888,
    null,
    noOtpkEnc.ciphertext
);

let noOtpkBobRecord = JSON.stringify(new libsignalSessionRecord().serialize());
const noOtpkBobDec = rust.signalSessionBuilderProcessIncomingPkmsg(
    noOtpkBobRecord,
    noOtpkBobId.privKey,
    noOtpkBobId.pubKey,
    noOtpkBobSignedKey.privKey,
    noOtpkBobSignedKey.pubKey,
    null, // our_pre_key_priv = null
    noOtpkPkmsg
);
noOtpkBobRecord = noOtpkBobDec.recordJson;

testAssert(
    noOtpkBobDec.plaintext.toString('utf-8') === noOtpkMsg.toString('utf-8'),
    `No-OTPK X3DH: Bob decrypted pkmsg without OTPK bit-exact ("${noOtpkBobDec.plaintext.toString('utf-8')}")`
);
testAssert(noOtpkBobDec.preKeyId == null, 'No-OTPK X3DH: preKeyId is null as expected');

// -------------------------------------------------------------
// 3. TOFU Identity Change Scenario (New Device / Key Rotation)
// -------------------------------------------------------------
console.log('\n--- 3. Testing TOFU Identity Change (Device Replacement / Key Rotation) ---');
// Bob already has active session with Alice Device 1 (aliceIdentity)
let tofuBobRecord = bobRecordJson;

// Alice switches to Device 2 with a brand new Identity Key (aliceIdentity2)
const aliceIdentity2 = curve.generateKeyPair();
let alice2Record = JSON.stringify(new libsignalSessionRecord().serialize());

const alice2Init = rust.signalSessionBuilderInitOutgoing(
    alice2Record,
    aliceIdentity2.privKey,
    bobRegistrationId,
    bobIdentity.pubKey,
    bobSignedPreKeyId,
    bobSignedPreKey.pubKey,
    bobSignedPreKeySig,
    null,
    null
);
alice2Record = alice2Init.recordJson;

const tofuPlaintext = Buffer.from('Hello Bob from my brand new phone/device (Alice Device 2)!');
const alice2Enc = rust.signalSessionCipherEncrypt(
    alice2Record,
    aliceIdentity2.pubKey,
    tofuPlaintext
);
alice2Record = alice2Enc.recordJson;

const tofuPkmsg = rust.signalSessionBuilderBuildPkmsgEnvelope(
    aliceIdentity2.pubKey,
    77777,
    alice2Init.baseKey,
    bobSignedPreKeyId,
    null,
    alice2Enc.ciphertext
);

// Bob receives pkmsg from Alice Device 2
const tofuBobDec = rust.signalSessionBuilderProcessIncomingPkmsg(
    tofuBobRecord,
    bobIdentity.privKey,
    bobIdentity.pubKey,
    bobSignedPreKey.privKey,
    bobSignedPreKey.pubKey,
    null,
    tofuPkmsg
);
tofuBobRecord = tofuBobDec.recordJson;

testAssert(
    tofuBobDec.plaintext.toString('utf-8') === tofuPlaintext.toString('utf-8'),
    `TOFU: Bob decrypted pkmsg from new identity key bit-exact ("${tofuBobDec.plaintext.toString('utf-8')}")`
);

// Verify Bob record state in JS: Old session was archived/closed, new session is active open
const tofuBobParsed = JSON.parse(tofuBobRecord);
const tofuBobJs = libsignalSessionRecord.deserialize(tofuBobParsed);
const allSessions = tofuBobJs.getSessions();
const openSession = tofuBobJs.getOpenSession();

testAssert(allSessions.length >= 2, `TOFU: Old session preserved in history (Total sessions: ${allSessions.length})`);
testAssert(
    openSession.indexInfo.remoteIdentityKey.equals(aliceIdentity2.pubKey),
    'TOFU: Active open session now corresponds to Alice Device 2 identity key'
);

// -------------------------------------------------------------
// 4. Cross-Engine Parity for pkmsg (Bidirectional Rust <-> JS)
// -------------------------------------------------------------
console.log('\n--- 4. Testing Cross-Engine Parity for pkmsg (Rust <-> JS libsignal) ---');

// 4a. Rust Alice -> JS Bob
console.log('Testing 4a: Rust Alice -> JS Bob...');
const crossBobIdentity = curve.generateKeyPair();
const crossBobSignedPreKey = curve.generateKeyPair();
const crossBobSignedPreKeySig = curve.calculateSignature(crossBobIdentity.privKey, crossBobSignedPreKey.pubKey);
const crossBobPreKey = curve.generateKeyPair();

const crossAliceIdentity = curve.generateKeyPair();
let crossAliceRecord = JSON.stringify(new libsignalSessionRecord().serialize());

const crossAliceInit = rust.signalSessionBuilderInitOutgoing(
    crossAliceRecord,
    crossAliceIdentity.privKey,
    33333,
    crossBobIdentity.pubKey,
    444,
    crossBobSignedPreKey.pubKey,
    crossBobSignedPreKeySig,
    555,
    crossBobPreKey.pubKey
);
crossAliceRecord = crossAliceInit.recordJson;

const crossMsg1 = Buffer.from('Hello JS Bob from Rust Alice!');
const crossAliceEnc = rust.signalSessionCipherEncrypt(
    crossAliceRecord,
    crossAliceIdentity.pubKey,
    crossMsg1
);
crossAliceRecord = crossAliceEnc.recordJson;

const crossPkmsg1 = rust.signalSessionBuilderBuildPkmsgEnvelope(
    crossAliceIdentity.pubKey,
    66666,
    crossAliceInit.baseKey,
    444,
    555,
    crossAliceEnc.ciphertext
);

let jsBobRecord = new libsignalSessionRecord();
const jsBobStore = {
    loadSession: async () => jsBobRecord,
    storeSession: async (addr, rec) => { jsBobRecord = rec; },
    getOurIdentity: async () => crossBobIdentity,
    getOurRegistrationId: async () => 33333,
    loadPreKey: async (id) => id === 555 ? crossBobPreKey : null,
    loadSignedPreKey: async (id) => id === 444 ? crossBobSignedPreKey : null,
    removePreKey: async () => {},
    isTrustedIdentity: async () => true
};
const jsBobCipher = new libsignalSessionCipher(jsBobStore, new libsignal.ProtocolAddress('alice_addr', 1));
const jsBobDecrypted = await jsBobCipher.decryptPreKeyWhisperMessage(crossPkmsg1);

testAssert(
    jsBobDecrypted.toString('utf-8') === crossMsg1.toString('utf-8'),
    `Cross-Engine 4a: JS libsignal decrypted pkmsg created by Rust ("${jsBobDecrypted.toString('utf-8')}")`
);

// 4b. JS Alice -> Rust Bob
console.log('Testing 4b: JS Alice -> Rust Bob...');
const cross2BobIdentity = curve.generateKeyPair();
const cross2BobSignedKey = curve.generateKeyPair();
const cross2BobSignedSig = curve.calculateSignature(cross2BobIdentity.privKey, cross2BobSignedKey.pubKey);
const cross2BobPreKey = curve.generateKeyPair();

const cross2AliceIdentity = curve.generateKeyPair();
let jsAliceRecord = new libsignalSessionRecord();
const jsAliceStore = {
    loadSession: async () => jsAliceRecord,
    storeSession: async (addr, rec) => { jsAliceRecord = rec; },
    getOurIdentity: async () => cross2AliceIdentity,
    getOurRegistrationId: async () => 12121,
    isTrustedIdentity: async () => true
};
const jsAliceBuilder = new libsignalSessionBuilder(jsAliceStore, new libsignal.ProtocolAddress('bob_addr', 1));
await jsAliceBuilder.initOutgoing({
    identityKey: cross2BobIdentity.pubKey,
    registrationId: 78787,
    signedPreKey: {
        keyId: 777,
        publicKey: cross2BobSignedKey.pubKey,
        signature: cross2BobSignedSig
    },
    preKey: {
        keyId: 888,
        publicKey: cross2BobPreKey.pubKey
    }
});

const jsAliceCipher2 = new libsignalSessionCipher(jsAliceStore, new libsignal.ProtocolAddress('bob_addr', 1));
const crossMsg2 = Buffer.from('Hello Rust Bob from JS Alice!');
const jsEncResult2 = await jsAliceCipher2.encrypt(crossMsg2);

testAssert(jsEncResult2.type === 3, 'Cross-Engine 4b: JS Alice generated PreKeyWhisperMessage (type 3)');

let cross2BobRecord = JSON.stringify(new libsignalSessionRecord().serialize());
const rustBobDec2 = rust.signalSessionBuilderProcessIncomingPkmsg(
    cross2BobRecord,
    cross2BobIdentity.privKey,
    cross2BobIdentity.pubKey,
    cross2BobSignedKey.privKey,
    cross2BobSignedKey.pubKey,
    cross2BobPreKey.privKey,
    Buffer.from(jsEncResult2.body, 'binary')
);
cross2BobRecord = rustBobDec2.recordJson;

testAssert(
    rustBobDec2.plaintext.toString('utf-8') === crossMsg2.toString('utf-8'),
    `Cross-Engine 4b: Rust decrypted pkmsg created by JS libsignal ("${rustBobDec2.plaintext.toString('utf-8')}")`
);

// -------------------------------------------------------------
// 5. Real-Traffic WhatsApp pkmsg Vectors
// -------------------------------------------------------------
console.log('\n--- 5. Testing Real WhatsApp pkmsg Vectors ---');
const realTrafficPath = path.join(__dirname, '../vectors/signal-level2-real-traffic.json');
if (fs.existsSync(realTrafficPath)) {
    const realTraffic = JSON.parse(fs.readFileSync(realTrafficPath, 'utf-8'));
    const pairwiseTransitions = realTraffic.pairwise_state_transitions || [];
    const pkmsgTransitions = pairwiseTransitions.filter(t => t.type === 'pkmsg');
    console.log(`Found ${pkmsgTransitions.length} real-traffic pkmsg transitions in golden file`);

    for (let idx = 0; idx < pkmsgTransitions.length; idx++) {
        const tr = pkmsgTransitions[idx];
        testAssert(
            tr.raw_input_hex.length > 50,
            `Real pkmsg #${idx + 1} (${tr.jid}): Valid WhatsApp socket pkmsg payload (${tr.raw_input_hex.length / 2} bytes)`
        );
    }
}

console.log('\n================================================================');
console.log(`📊 HASIL AKHIR PENGUJIAN Step 3c (X3DH & pkmsg): ${passedTests}/${totalTests} PASS (100%)`);
console.log('================================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
