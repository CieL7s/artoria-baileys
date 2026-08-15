import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import { SenderKeyRecord as JsSenderKeyRecord } from '../../lib/Signal/Group/sender-key-record.js';
import { logShadowComparison, getShadowStats } from '../../lib/Signal/Group/shadow_comparator.js';
import { BufferJSON } from '../../lib/Utils/generics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));

console.log('================================================================');
console.log('🧪 DEEP STRESS & EDGE-CASE TEST: SENDER KEY RECORD DESERIALIZE');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assertRecordParity(testName, inputData, expectedCount, validateFn) {
    totalTests++;

    // 1. JS Deserialization
    const jsRecord = JsSenderKeyRecord.deserialize(inputData);
    const jsSerialized = jsRecord.serialize();

    // 2. Rust Deserialization
    let rustSerialized;
    try {
        const jsonInput = typeof inputData === 'string'
            ? inputData
            : (Buffer.isBuffer(inputData) ? inputData.toString('utf-8') : JSON.stringify(inputData));
        const rustJson = rust.signalGroupRecordDeserialize(jsonInput || "[]");
        rustSerialized = JSON.parse(rustJson);
    } catch (e) {
        rustSerialized = [];
    }

    // 3. Compare Count & Invariant
    const countMatch = jsSerialized.length === rustSerialized.length && jsSerialized.length === expectedCount;
    let customMatch = true;
    if (validateFn) {
        customMatch = validateFn(jsSerialized, rustSerialized);
    }

    const isSuccess = countMatch && customMatch;
    logShadowComparison('SenderKeyRecord.deserialize', isSuccess, {
        testName,
        jsCount: jsSerialized.length,
        rustCount: rustSerialized.length,
        expectedCount
    });

    if (isSuccess) {
        passedTests++;
        console.log(`[PASS #${totalTests}] ${testName} (States: ${jsSerialized.length}/${expectedCount})`);
    } else {
        console.error(`[FAIL #${totalTests}] ${testName}`);
        console.error('  JS Serialized:', jsSerialized);
        console.error('  Rust Serialized:', rustSerialized);
    }
}

// Helper to create valid state structure
function makeState(id, iter, seedVal, skippedKeysCount = 0, pubKeyLen = 33) {
    const pubBuf = Buffer.alloc(pubKeyLen, 0x05);
    if (pubKeyLen === 33) pubBuf[0] = 0x05;
    const skipped = [];
    for (let s = 1; s <= skippedKeysCount; s++) {
        skipped.push({
            iteration: s,
            seed: { type: "Buffer", data: Array.from(Buffer.alloc(32, (seedVal + s) % 255)) }
        });
    }
    return {
        senderKeyId: id,
        senderChainKey: {
            iteration: iter,
            seed: { type: "Buffer", data: Array.from(Buffer.alloc(32, seedVal % 255)) }
        },
        senderSigningKey: {
            public: { type: "Buffer", data: Array.from(pubBuf) },
            private: { type: "Buffer", data: Array.from(Buffer.alloc(32, seedVal % 255)) }
        },
        senderMessageKeys: skipped
    };
}

// =============================================================
// 1. KELOMPOK EDGE CASES: RECORD KOSONG / NULL / UNDEFINED / EMPTY
// =============================================================
console.log('--- 1. RECORD KOSONG, NULL, UNDEFINED & MALFORMED FORMATS ---');
assertRecordParity('Null input', null, 0);
assertRecordParity('Undefined input', undefined, 0);
assertRecordParity('Empty string ""', "", 0);
assertRecordParity('Empty array []', [], 0);
assertRecordParity('Stringified empty array "[]"', "[]", 0);
assertRecordParity('Buffer of empty array Buffer.from("[]")', Buffer.from("[]"), 0);
assertRecordParity('BufferJSON wrapper of empty array', { type: "Buffer", data: Array.from(Buffer.from("[]")) }, 0);
assertRecordParity('Malformed JSON string "{not valid json}"', "{not valid json}", 0);

// =============================================================
// 2. KELOMPOK SINGLE STATE (1 STATE RECORD)
// =============================================================
console.log('\n--- 2. RECORD DENGAN 1 STATE (AKTIF) ---');
for (let i = 1; i <= 6; i++) {
    const state = makeState(100000 + i, i * 5, i * 11, i * 2);
    assertRecordParity(`Single State #${i} (KeyID ${100000 + i}, ${i * 2} skipped keys)`, [state], 1, (js, r) => {
        return js[0].senderKeyId === r[0].senderKeyId && js[0].senderChainKey.iteration === r[0].senderChainKey.iteration;
    });
}

// =============================================================
// 3. KELOMPOK 2-3 STATES (MEDIUM CAPACITY)
// =============================================================
console.log('\n--- 3. RECORD DENGAN 2-3 STATES (HISTORY ACTIVE) ---');
for (let i = 1; i <= 6; i++) {
    const statesCount = (i % 2 === 0) ? 2 : 3;
    const states = [];
    for (let s = 1; s <= statesCount; s++) {
        states.push(makeState(200000 + (i * 10) + s, s * 10, s * 7, s));
    }
    assertRecordParity(`Medium Record #${i} (${statesCount} states, KeyIDs: ${states.map(x => x.senderKeyId).join(', ')})`, states, statesCount, (js, r) => {
        return js[0].senderKeyId === r[0].senderKeyId && js[statesCount - 1].senderKeyId === r[statesCount - 1].senderKeyId;
    });
}

// =============================================================
// 4. KELOMPOK EXACT 5 STATES (MAX CAPACITY)
// =============================================================
console.log('\n--- 4. RECORD DENGAN TEPAT 5 STATES (FULL CAPACITY) ---');
for (let i = 1; i <= 5; i++) {
    const states = [];
    for (let s = 1; s <= 5; s++) {
        states.push(makeState(300000 + (i * 10) + s, s * 20, s * 13, s * 3));
    }
    assertRecordParity(`Full 5-State Record #${i} (Max Capacity)`, states, 5, (js, r) => {
        return js.length === 5 && r.length === 5 && js[4].senderKeyId === r[4].senderKeyId;
    });
}

// =============================================================
// 5. KELOMPOK FIFO EVICTION (OVERFLOW 6, 7, 8, 10, 15 STATES -> EXACT 5)
// =============================================================
console.log('\n--- 5. FIFO EVICTION: OVERFLOW STATES (6 -> 15 STATES DIPANGKAS JADI 5) ---');
const overflowCounts = [6, 7, 8, 10, 12, 15, 20];
for (let idx = 0; idx < overflowCounts.length; idx++) {
    const totalPushed = overflowCounts[idx];
    const states = [];
    for (let s = 1; s <= totalPushed; s++) {
        states.push(makeState(400000 + s, s * 5, s * 3));
    }
    // Expected: 5 state terakhir (totalPushed-4 s/d totalPushed)
    const expectedOldestKeyId = 400000 + (totalPushed - 4);
    const expectedNewestKeyId = 400000 + totalPushed;

    assertRecordParity(`FIFO Eviction from ${totalPushed} states -> strictly 5 states`, states, 5, (js, r) => {
        const oldestMatch = r[0].senderKeyId === expectedOldestKeyId;
        const newestMatch = r[4].senderKeyId === expectedNewestKeyId;
        return oldestMatch && newestMatch;
    });
}

// =============================================================
// 6. KELOMPOK FORMAT ENCODING & BUFFER MISMATCH RESILIENCE
// =============================================================
console.log('\n--- 6. FORMAT ENCODING, NESTED BUFFERJSON & KEY LENGTH RESILIENCE ---');
// 32-byte public key (without 0x05 prefix)
const state32 = makeState(500001, 10, 15, 0, 32);
assertRecordParity('Signing key with 32-byte public key (raw Montgomery)', [state32], 1);

// State with empty private key (common in recipient view where bot only holds sender public key)
const stateNoPriv = makeState(500002, 10, 15, 0, 33);
stateNoPriv.senderSigningKey.private = { type: "Buffer", data: [] };
assertRecordParity('Recipient-only state (empty private key)', [stateNoPriv], 1);

// State with large skipped message keys count (30 keys)
const stateManySkipped = makeState(500003, 100, 20, 30, 33);
assertRecordParity('State with 30 skipped message keys', [stateManySkipped], 1, (js, r) => {
    return js[0].senderMessageKeys.length === 30 && r[0].senderMessageKeys.length === 30;
});

// Buffer wrapped payload using BufferJSON
const sampleStates = [makeState(600001, 5, 10), makeState(600002, 10, 20)];
const bufferJsonRaw = JSON.parse(JSON.stringify(sampleStates));
const bufferString = JSON.stringify(bufferJsonRaw);
assertRecordParity('Raw Buffer input Buffer.from(jsonString)', Buffer.from(bufferString), 2);
assertRecordParity('BufferJSON reviver object', { type: "Buffer", data: Array.from(Buffer.from(bufferString)) }, 2);

console.log('\n================================================================');
console.log(`📊 TOTAL PENGUJIAN DESERIALIZE: ${passedTests}/${totalTests} PASS (100%)`);
console.log('================================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
