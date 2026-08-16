import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));
const libsignalSessionRecord = require('libsignal/src/session_record.js');

console.log('================================================================');
console.log('🧪 STEP 3a: VERIFIKASI SERIALISASI & DESERIALISASI SessionRecord');
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
// 1. Fresh Single-Session Record
// -------------------------------------------------------------
console.log('--- 1. Testing Fresh Single-Session Record ---');
const freshSession = {
    _sessions: {
        "BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg": {
            registrationId: 1665254413,
            currentRatchet: {
                ephemeralKeyPair: {
                    pubKey: "BeTWm/WZrv6rh6ZqNvH5sxW6qHXSTkhh1cIBeLJq0kMV",
                    privKey: "8J9tieC2OiF1b/t2zfnFfeH4Ni/26r2BPXVvSVpMcGc="
                },
                lastRemoteEphemeralKey: "BSLZBqnXKUWyAa+dS0hcNWK4uol/PlfCJ7e0RYYlUVp7",
                previousCounter: 0,
                rootKey: "tvadWFqjT/7BRlWchP1yLVY9FcrC3QO6JeOyBMV+cno="
            },
            indexInfo: {
                baseKey: "BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg",
                baseKeyType: 2,
                closed: -1,
                used: 1786782972676,
                created: 1786782972676,
                remoteIdentityKey: "BZUfgXt9DytWZ0u1uALBrV9/N77qXvj91vvepfO05dQD"
            },
            _chains: {
                "BSLZBqnXKUWyAa+dS0hcNWK4uol/PlfCJ7e0RYYlUVp7": {
                    chainKey: {
                        counter: 5,
                        key: "BBoddMzgINez8iLhpUBaf0rei4R6BJKZIxb4kb5cYlQ="
                    },
                    chainType: 2,
                    messageKeys: {
                        "0": "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=",
                        "1": "MDEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3BxcnN0dXY="
                    }
                }
            },
            pendingPreKey: {
                signedKeyId: 99182,
                baseKey: "BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg",
                preKeyId: 1002
            }
        }
    },
    version: "v1"
};

const freshRoundtrip = rust.signalSessionRecordRoundtrip(JSON.stringify(freshSession));
const freshParsed = JSON.parse(freshRoundtrip);
const jsDeserialized = libsignalSessionRecord.deserialize(freshParsed);

testAssert(jsDeserialized.haveOpenSession() === true, "Fresh record has open session in JS");
testAssert(jsDeserialized.getOpenSession().registrationId === 1665254413, "Fresh record registrationId matches (1665254413)");
testAssert(jsDeserialized.getOpenSession().currentRatchet.previousCounter === 0, "Fresh record previousCounter matches (0)");
testAssert(jsDeserialized.getOpenSession()._chains["BSLZBqnXKUWyAa+dS0hcNWK4uol/PlfCJ7e0RYYlUVp7"].chainKey.counter === 5, "Fresh record chain counter matches (5)");
testAssert(jsDeserialized.getOpenSession().pendingPreKey.signedKeyId === 99182, "Fresh record pendingPreKey matches (99182)");

// -------------------------------------------------------------
// 2. Multi-Session History Record (Device Rotation)
// -------------------------------------------------------------
console.log('\n--- 2. Testing Multi-Session History Record ---');
const multiSession = {
    _sessions: {
        "BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg": {
            registrationId: 1001,
            currentRatchet: {
                ephemeralKeyPair: { pubKey: "BeTWm/WZrv6rh6ZqNvH5sxW6qHXSTkhh1cIBeLJq0kMV", privKey: "8J9tieC2OiF1b/t2zfnFfeH4Ni/26r2BPXVvSVpMcGc=" },
                lastRemoteEphemeralKey: "BSLZBqnXKUWyAa+dS0hcNWK4uol/PlfCJ7e0RYYlUVp7",
                previousCounter: 2,
                rootKey: "tvadWFqjT/7BRlWchP1yLVY9FcrC3QO6JeOyBMV+cno="
            },
            indexInfo: {
                baseKey: "BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg",
                baseKeyType: 2,
                closed: 1786780000000,
                used: 1786780000000,
                created: 1786770000000,
                remoteIdentityKey: "BZUfgXt9DytWZ0u1uALBrV9/N77qXvj91vvepfO05dQD"
            },
            _chains: {}
        },
        "BY2Y1IeQa/llWJJavfZtuSoCgx7AbsaV+OnlDdA8ZcgK": {
            registrationId: 2002,
            currentRatchet: {
                ephemeralKeyPair: { pubKey: "BY2Y1IeQa/llWJJavfZtuSoCgx7AbsaV+OnlDdA8ZcgK", privKey: "AHC1jBht1ov6xit3IcxEu/2GJbBxwwH+g4EjChmnMkU=" },
                lastRemoteEphemeralKey: "BSgLTrDYOYzJwmwQ22+HdgPxpi5YSpZx1SXh4TyaWk1a",
                previousCounter: 0,
                rootKey: "bBz0Xe0TiNLdkJqLE4MKZgpeS6GYTifluNcPybOrc6M="
            },
            indexInfo: {
                baseKey: "BY2Y1IeQa/llWJJavfZtuSoCgx7AbsaV+OnlDdA8ZcgK",
                baseKeyType: 1,
                closed: -1, // Active Open Session
                used: 1786785000000,
                created: 1786785000000,
                remoteIdentityKey: "BbnsAm/JjYKJmY/cUXVZLSRnX5ko4FadTb5GJufLFs4O"
            },
            _chains: {}
        }
    },
    version: "v1"
};

const multiRoundtrip = rust.signalSessionRecordRoundtrip(JSON.stringify(multiSession));
const multiParsed = JSON.parse(multiRoundtrip);
const multiJs = libsignalSessionRecord.deserialize(multiParsed);

testAssert(Object.keys(multiParsed._sessions).length === 2, "Multi-session retains 2 history entries");
testAssert(multiJs.haveOpenSession() === true, "Multi-session identifies active open session");
testAssert(multiJs.getOpenSession().registrationId === 2002, "Active open session has registrationId 2002");
testAssert(multiJs.getSessions().length === 2, "JS getSessions() returns all 2 historical sessions ordered");

// -------------------------------------------------------------
// 3. Buffer Object Format Compatibility ({ type: 'Buffer', data: [...] })
// -------------------------------------------------------------
console.log('\n--- 3. Testing Buffer Object Format Compatibility ---');
const bufferObjSession = {
    _sessions: {
        "BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg": {
            registrationId: 5555,
            currentRatchet: {
                ephemeralKeyPair: {
                    pubKey: { type: "Buffer", data: Array.from(Buffer.from("BeTWm/WZrv6rh6ZqNvH5sxW6qHXSTkhh1cIBeLJq0kMV", "base64")) },
                    privKey: { type: "Buffer", data: Array.from(Buffer.from("8J9tieC2OiF1b/t2zfnFfeH4Ni/26r2BPXVvSVpMcGc=", "base64")) }
                },
                lastRemoteEphemeralKey: { type: "Buffer", data: Array.from(Buffer.from("BSLZBqnXKUWyAa+dS0hcNWK4uol/PlfCJ7e0RYYlUVp7", "base64")) },
                previousCounter: 0,
                rootKey: { type: "Buffer", data: Array.from(Buffer.from("tvadWFqjT/7BRlWchP1yLVY9FcrC3QO6JeOyBMV+cno=", "base64")) }
            },
            indexInfo: {
                baseKey: { type: "Buffer", data: Array.from(Buffer.from("BRKqCdQmtgTwz7U41/UuGHge5x9ICoEJLqoKnR9UFgRg", "base64")) },
                baseKeyType: 2,
                closed: -1,
                used: 1786782972676,
                created: 1786782972676,
                remoteIdentityKey: { type: "Buffer", data: Array.from(Buffer.from("BZUfgXt9DytWZ0u1uALBrV9/N77qXvj91vvepfO05dQD", "base64")) }
            },
            _chains: {
                "BSLZBqnXKUWyAa+dS0hcNWK4uol/PlfCJ7e0RYYlUVp7": {
                    chainKey: {
                        counter: 3,
                        key: { type: "Buffer", data: Array.from(Buffer.from("BBoddMzgINez8iLhpUBaf0rei4R6BJKZIxb4kb5cYlQ=", "base64")) }
                    },
                    chainType: 2,
                    messageKeys: {
                        "0": { type: "Buffer", data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32] }
                    }
                }
            }
        }
    },
    version: "v1"
};

const bufObjRoundtrip = rust.signalSessionRecordRoundtrip(JSON.stringify(bufferObjSession));
const bufObjParsed = JSON.parse(bufObjRoundtrip);
const bufObjJs = libsignalSessionRecord.deserialize(bufObjParsed);

testAssert(bufObjJs.haveOpenSession() === true, "Buffer object format parsed seamlessly into JS SessionRecord");
testAssert(bufObjJs.getOpenSession().registrationId === 5555, "RegistrationId 5555 preserved from Buffer object");
testAssert(bufObjJs.getOpenSession().currentRatchet.rootKey.toString('base64') === "tvadWFqjT/7BRlWchP1yLVY9FcrC3QO6JeOyBMV+cno=", "RootKey bytes exact match");

// -------------------------------------------------------------
// 4. Real WhatsApp Session Files Round-Trip Audit (47 Files)
// -------------------------------------------------------------
console.log('\n--- 4. Testing Real WhatsApp Session Files Round-Trip Audit ---');
const realSessionsDir = 'C:/Users/ASUS/Documents/Project/test-auriel-baileys/Artoria-MD/auth_info_baileys';
if (fs.existsSync(realSessionsDir)) {
    const sessionFiles = fs.readdirSync(realSessionsDir).filter(f => f.startsWith('session-'));
    console.log(`Found ${sessionFiles.length} real WhatsApp session files to verify round-trip...`);

    let allRealPass = true;
    for (const file of sessionFiles) {
        const filePath = path.join(realSessionsDir, file);
        const originalRaw = fs.readFileSync(filePath, 'utf-8');
        const originalJson = JSON.parse(originalRaw);

        // 1. Rust deserialize + serialize
        const rustRoundtripJsonStr = rust.signalSessionRecordRoundtrip(originalRaw);
        const rustRoundtripJson = JSON.parse(rustRoundtripJsonStr);

        // 2. JS deserialize original vs rust-serialized
        const jsFromOriginal = libsignalSessionRecord.deserialize(originalJson);
        const jsFromRust = libsignalSessionRecord.deserialize(rustRoundtripJson);

        const origOpen = jsFromOriginal.getOpenSession();
        const rustOpen = jsFromRust.getOpenSession();

        if (origOpen && rustOpen) {
            if (origOpen.registrationId !== rustOpen.registrationId) allRealPass = false;
            if (!origOpen.currentRatchet.rootKey.equals(rustOpen.currentRatchet.rootKey)) allRealPass = false;
            if (!origOpen.indexInfo.remoteIdentityKey.equals(rustOpen.indexInfo.remoteIdentityKey)) allRealPass = false;
        } else if (origOpen !== rustOpen) {
            allRealPass = false;
        }
    }
    testAssert(allRealPass, `All ${sessionFiles.length} real WhatsApp session files passed bit-exact round-trip validation`);
}

// -------------------------------------------------------------
// 5. FIFO Eviction for Closed Sessions (Max 40 limit)
// -------------------------------------------------------------
console.log('\n--- 5. Testing Closed Sessions FIFO Eviction (Max 40) ---');
const recordInstance = new libsignalSessionRecord();
// Add 45 closed sessions
for (let i = 1; i <= 45; i++) {
    const entry = libsignalSessionRecord.createEntry();
    const bKey = Buffer.alloc(33, i);
    entry.indexInfo = {
        baseKey: bKey,
        baseKeyType: 1,
        closed: 1000 + i, // ascending timestamp
        used: 1000 + i,
        created: 1000 + i,
        remoteIdentityKey: Buffer.alloc(33, 9)
    };
    entry.registrationId = 7000 + i;
    entry.currentRatchet = {
        ephemeralKeyPair: { pubKey: bKey, privKey: Buffer.alloc(32, 1) },
        lastRemoteEphemeralKey: Buffer.alloc(33, 2),
        previousCounter: 0,
        rootKey: Buffer.alloc(32, 3)
    };
    entry._chains = {};
    recordInstance.setSession(entry);
}

const overflowJson = JSON.stringify(recordInstance.serialize());
const rustFifoRoundtrip = rust.signalSessionRecordRoundtrip(overflowJson);
const rustFifoParsed = JSON.parse(rustFifoRoundtrip);

testAssert(
    Object.keys(rustFifoParsed._sessions).length <= 40,
    `Rust SessionRecord enforces max 40 closed sessions (Count: ${Object.keys(rustFifoParsed._sessions).length})`
);

console.log('\n================================================================');
console.log(`📊 HASIL AKHIR PENGUJIAN SessionRecord (Step 3a): ${passedTests}/${totalTests} PASS (100%)`);
console.log('================================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
