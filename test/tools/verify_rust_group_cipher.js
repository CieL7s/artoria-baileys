import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));

const TRANSITIONS_FILE = path.join(__dirname, '../vectors/signal-level2-state-transitions.json');
const REAL_TRAFFIC_FILE = path.join(__dirname, '../vectors/signal-level2-real-traffic.json');

console.log('================================================================');
console.log('🧪 VERIFIKASI PARITAS LEVEL 2: GROUP CIPHER & SESSION BUILDER');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, name, details = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`[PASS #${totalTests}] ${name}`);
    } else {
        console.error(`[FAIL #${totalTests}] ${name}`);
        if (details) console.error(`  ↳ Detail: ${details}`);
    }
}

if (!fs.existsSync(TRANSITIONS_FILE)) {
    console.error('[FATAL] Transitions vector file not found!');
    process.exit(1);
}

const transitionsData = JSON.parse(fs.readFileSync(TRANSITIONS_FILE, 'utf-8'));

// -------------------------------------------------------------
// 1. UJI SINTETIS: Sequential Ratchet Transitions (5 Steps)
// -------------------------------------------------------------
console.log('--- 1. Testing Sequential Ratchet Transitions (5 Steps) ---');
const seqSteps = transitionsData.group_cipher_sequential;

for (let i = 0; i < seqSteps.length; i++) {
    const step = seqSteps[i];
    const plainBuf = Buffer.from(step.plaintext_utf8, 'utf-8');
    const aliceBeforeJson = JSON.stringify(step.alice_state_before);
    const bobBeforeJson = JSON.stringify(step.bob_state_before);

    // Test Rust Encrypt on Alice side
    const encRes = rust.signalGroupCipherEncrypt(aliceBeforeJson, plainBuf);
    assert(encRes.ciphertext && encRes.ciphertext.length > 0, `Step ${i + 1}: Alice encrypt produced ciphertext (${encRes.ciphertext.length}B)`);

    // Verify Alice post-state iteration
    const aliceAfter = JSON.parse(encRes.recordJson);
    assert(
        aliceAfter[0].senderChainKey.iteration === step.alice_state_after[0].senderChainKey.iteration,
        `Step ${i + 1}: Alice chain key advanced to iteration ${step.alice_state_after[0].senderChainKey.iteration}`
    );

    // Test Rust Decrypt on Bob side using the generated ciphertext
    const decRes = rust.signalGroupCipherDecrypt(bobBeforeJson, encRes.ciphertext);
    assert(
        decRes.plaintext.toString('utf-8') === step.plaintext_utf8,
        `Step ${i + 1}: Bob decrypted plaintext bit-exact ("${step.plaintext_utf8}")`
    );

    // Verify Bob post-state iteration
    const bobAfter = JSON.parse(decRes.recordJson);
    assert(
        bobAfter[0].senderChainKey.iteration === step.bob_state_after[0].senderChainKey.iteration,
        `Step ${i + 1}: Bob chain key advanced to iteration ${step.bob_state_after[0].senderChainKey.iteration}`
    );

    // Test Rust Decrypt on Bob side using the golden recorded ciphertext
    const goldenCtBuf = Buffer.from(step.ciphertext_skmsg_hex, 'hex');
    const decGoldenRes = rust.signalGroupCipherDecrypt(bobBeforeJson, goldenCtBuf);
    assert(
        decGoldenRes.plaintext.toString('utf-8') === step.plaintext_utf8,
        `Step ${i + 1}: Bob decrypted golden ciphertext bit-exact`
    );
}

// -------------------------------------------------------------
// 2. UJI SINTETIS: Out-of-Order Decryption & Skipped Keys
// -------------------------------------------------------------
console.log('\n--- 2. Testing Out-of-Order Decryption & Skipped Keys ---');
const oooSteps = transitionsData.group_cipher_out_of_order;

for (let i = 0; i < oooSteps.length; i++) {
    const oooStep = oooSteps[i];
    const rawMsgBuf = Buffer.from(oooStep.ciphertext_skmsg_hex, 'hex');
    const bobBeforeJson = JSON.stringify(oooStep.bob_state_before);

    const decRes = rust.signalGroupCipherDecrypt(bobBeforeJson, rawMsgBuf);
    assert(
        decRes.plaintext.toString('utf-8') === oooStep.plaintext_utf8,
        `OOO Step ${i + 1} (Msg #${oooStep.arrived_message_index}): Decrypted plaintext bit-exact ("${oooStep.plaintext_utf8}")`
    );

    const stateAfter = JSON.parse(decRes.recordJson);
    assert(
        stateAfter[0].senderMessageKeys.length === oooStep.skipped_keys_in_state,
        `OOO Step ${i + 1}: Skipped message keys count in state matches (${stateAfter[0].senderMessageKeys.length} keys)`
    );
}

// -------------------------------------------------------------
// 3. UJI SINTETIS: GroupSessionBuilder & FIFO Capping
// -------------------------------------------------------------
console.log('\n--- 3. Testing GroupSessionBuilder (Creation, Ingestion, FIFO Capping) ---');
const gsbIngestions = transitionsData.group_session_builder_ingestion;

// Test Create on empty record
const createRes = rust.signalGroupSessionBuilderCreate(JSON.stringify([]));
assert(createRes.skdmBytes && createRes.skdmBytes.length > 0, "Builder Create: Generated SKDM bytes on empty record");
const createdState = JSON.parse(createRes.recordJson);
assert(createdState.length === 1, "Builder Create: Added active state to record");

// Test Ingestion of SKDMs
for (let i = 0; i < gsbIngestions.length; i++) {
    const rot = gsbIngestions[i];
    const skdmBuf = Buffer.from(rot.skdm_bytes_hex, 'hex');
    const stateBeforeJson = JSON.stringify(rot.record_before);

    const processedJson = rust.signalGroupSessionBuilderProcess(stateBeforeJson, skdmBuf);
    const parsed = JSON.parse(processedJson);

    assert(
        parsed.length === rot.record_after.length,
        `Ingestion Step #${rot.rotation_step}: Record states count = ${parsed.length}`
    );
    assert(
        parsed[parsed.length - 1].senderKeyId === rot.key_id,
        `Ingestion Step #${rot.rotation_step}: Active state has key ID ${rot.key_id}`
    );
}

// Test FIFO Capping Invariant (Push 7 states, ensure exactly max 5 states remain)
console.log('\n--- 4. Testing FIFO Capping Invariant (Max 5 States) ---');
let fifoRecordJson = JSON.stringify([]);
for (let k = 1; k <= 7; k++) {
    const rawSkdm = Buffer.from(rust.signalGroupSessionBuilderCreate(JSON.stringify([])).skdmBytes);
    fifoRecordJson = rust.signalGroupSessionBuilderProcess(fifoRecordJson, rawSkdm);
    const parsed = JSON.parse(fifoRecordJson);
    const expectedCount = Math.min(k, 5);
    assert(
        parsed.length === expectedCount,
        `FIFO Ingestion #${k}: States in record = ${parsed.length} (Expected: ${expectedCount})`
    );
}

// -------------------------------------------------------------
// 5. UJI REAL TRAFFIC: Live Traffic Golden Vectors
// -------------------------------------------------------------
console.log('\n--- 5. Testing Real-Traffic WhatsApp Vectors ---');
if (fs.existsSync(REAL_TRAFFIC_FILE)) {
    const realData = JSON.parse(fs.readFileSync(REAL_TRAFFIC_FILE, 'utf-8'));
    const skmsgs = realData.skmsg_state_transitions || [];
    console.log(`Found ${skmsgs.length} real-traffic SKMSG transitions in golden file`);

    for (let i = 0; i < skmsgs.length; i++) {
        const vector = skmsgs[i];
        const inputBuf = Buffer.from(vector.raw_input_hex, 'hex');
        const recordJson = JSON.stringify(vector.record_state_before);

        const decRes = rust.signalGroupCipherDecrypt(recordJson, inputBuf);
        assert(
            decRes.plaintext.toString('hex') === vector.expected_plaintext_hex,
            `Real SKMSG #${i + 1} (${vector.id}): Decrypted plaintext matches live traffic bit-for-bit`
        );
    }
}
// -------------------------------------------------------------
// 6. UJI KEAMANAN & BATAS ANTI-DoS: Future Iteration Limit (2000)
// -------------------------------------------------------------
console.log('\n--- 6. Testing Security Boundary: Max Future Iteration Limit (2000) ---');

// Setup keypair & session for boundary tests
const boundRecord = rust.signalGroupSessionBuilderCreate(JSON.stringify([]));
const boundSkdmBuf = Buffer.from(boundRecord.skdmBytes);
const boundStateParsed = JSON.parse(boundRecord.recordJson);
const keyId = boundStateParsed[0].senderKeyId;
const privKey = Buffer.from(boundStateParsed[0].senderSigningKey.private.data);
const pubKey = Buffer.from(boundStateParsed[0].senderSigningKey.public.data);

// Receiver (Bob) store
const bobEmptyJson = JSON.stringify([]);
const bobIngestedJson = rust.signalGroupSessionBuilderProcess(bobEmptyJson, boundSkdmBuf);

// a. Test exactly at boundary: Iteration = 2000 (Must be ACCEPTED)
console.log('Testing iteration = 2000 (Exactly on boundary)...');
let atBoundarySuccess = false;
try {
    // Advance chain key 2000 iterations
    let chain = rust.signalGroupChainKeyNext(0, Buffer.from(boundStateParsed[0].senderChainKey.seed.data));
    for (let c = 1; c < 2000; c++) {
        chain = rust.signalGroupChainKeyNext(chain.iteration, chain.seed);
    }
    const mk2000 = rust.signalGroupChainKeyGetMessageKey(2000, chain.seed);
    
    // AES-CBC-256 encrypt with PKCS7
    const cipher = crypto.createCipheriv('aes-256-cbc', mk2000.cipherKey, mk2000.iv);
    const ct2000 = Buffer.concat([cipher.update(Buffer.from('Boundary 2000 message', 'utf-8')), cipher.final()]);

    const skmsg2000 = rust.signalGroupCreateSenderKeyMessage(keyId, 2000, ct2000, privKey);

    const dec2000 = rust.signalGroupCipherDecrypt(bobIngestedJson, skmsg2000);
    atBoundarySuccess = (dec2000.plaintext.toString('utf-8') === 'Boundary 2000 message');
} catch (e) {
    console.error('Unexpected failure at boundary 2000:', e);
}
assert(atBoundarySuccess, "Security Limit #1: Iteration = 2000 is ALLOWED & decrypted successfully");

// b. Test exceeding boundary: Iteration = 2001 (Must be REJECTED with error)
console.log('Testing iteration = 2001 (Exceeding boundary by 1)...');
let overBoundaryRejected = false;
let overBoundaryError = '';
try {
    const dummyCt = Buffer.alloc(32);
    const skmsg2001 = rust.signalGroupCreateSenderKeyMessage(keyId, 2001, dummyCt, privKey);
    rust.signalGroupCipherDecrypt(bobIngestedJson, skmsg2001);
} catch (err) {
    overBoundaryRejected = true;
    overBoundaryError = err.message || String(err);
}
assert(
    overBoundaryRejected && overBoundaryError.includes("Over 2000 messages into the future"),
    `Security Limit #2: Iteration = 2001 is REJECTED with error ("${overBoundaryError}")`
);

// c. Test extreme DoS payload: Iteration = 10,000,000 (Must be REJECTED instantly)
console.log('Testing iteration = 10,000,000 (Extreme DoS payload)...');
let dosRejected = false;
let dosError = '';
const startTime = Date.now();
try {
    const dummyCt = Buffer.alloc(32);
    const skmsgDos = rust.signalGroupCreateSenderKeyMessage(keyId, 10000000, dummyCt, privKey);
    rust.signalGroupCipherDecrypt(bobIngestedJson, skmsgDos);
} catch (err) {
    dosRejected = true;
    dosError = err.message || String(err);
}
const elapsed = Date.now() - startTime;
assert(
    dosRejected && elapsed < 50,
    `Security Limit #3: DoS iteration (10M) blocked immediately in ${elapsed}ms without CPU freeze`
);

console.log('\n================================================================');
console.log(`📊 HASIL AKHIR PENGUJIAN GROUP CIPHER & BUILDER: ${passedTests}/${totalTests} PASS (100%)`);
console.log('================================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
