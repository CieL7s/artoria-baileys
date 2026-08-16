import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import libsignal from 'libsignal';
import { createKeyPair } from 'libsignal/src/curve.js';

import { GroupCipher } from '../../lib/Signal/Group/group_cipher.js';
import { GroupSessionBuilder } from '../../lib/Signal/Group/group-session-builder.js';
import { SenderKeyName } from '../../lib/Signal/Group/sender-key-name.js';
import { SenderKeyRecord } from '../../lib/Signal/Group/sender-key-record.js';
import { SenderKeyDistributionMessage } from '../../lib/Signal/Group/sender-key-distribution-message.js';
import { BufferJSON } from '../../lib/Utils/generics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = path.join(__dirname, '../vectors');
const VECTOR_FILE = path.join(VECTOR_DIR, 'signal-level2-state-transitions.json');

if (!fs.existsSync(VECTOR_DIR)) {
    fs.mkdirSync(VECTOR_DIR, { recursive: true });
}

// In-Memory Test Store with Deep Cloning
class InMemorySenderKeyStore {
    constructor() {
        this.store = new Map();
    }
    async loadSenderKey(senderKeyName) {
        const key = senderKeyName.toString();
        const raw = this.store.get(key);
        if (!raw) return new SenderKeyRecord();
        return new SenderKeyRecord(JSON.parse(JSON.stringify(raw)));
    }
    async storeSenderKey(senderKeyName, record) {
        const key = senderKeyName.toString();
        this.store.set(key, JSON.parse(JSON.stringify(record.serialize())));
    }
}

// Generate valid keypair
function generateKeypair(seedByte) {
    const raw = Buffer.alloc(32, seedByte);
    const kp = createKeyPair(raw);
    return {
        privateKey: kp.privKey,
        publicKey: kp.pubKey
    };
}

async function buildLevel2Vectors() {
    console.log('Generating Level 2 State-Transition Vectors...');
    const result = {
        schema_version: "2.0.0",
        description: "Golden State-Transition Test Vectors for Level 2 Signal Ciphers and State Machine",
        generated_at: new Date().toISOString(),
        group_cipher_sequential: [],
        group_cipher_out_of_order: [],
        group_session_builder_ingestion: [],
        session_cipher_pairwise: [],
        lid_pn_mapping: []
    };

    // =========================================================
    // 1. GroupCipher: Sequential 5-Message Ratchet Transitions
    // =========================================================
    console.log('1. Building GroupCipher Sequential Vectors...');
    const storeAlice = new InMemorySenderKeyStore();
    const storeBob = new InMemorySenderKeyStore();
    const groupName = new SenderKeyName("120363409742668546@g.us", "628123456789::1");

    // Initialize SenderKey via GroupSessionBuilder
    const builderAlice = new GroupSessionBuilder(storeAlice);
    const skdm = await builderAlice.create(groupName);

    // Bob processes SKDM
    const builderBob = new GroupSessionBuilder(storeBob);
    await builderBob.process(groupName, skdm);

    const cipherAlice = new GroupCipher(storeAlice, groupName);
    const cipherBob = new GroupCipher(storeBob, groupName);

    const messages = [
        "Message #1: Initial session establishment",
        "Message #2: Ratchet chain step 1 advancing HMAC-SHA256",
        "Message #3: Multi-byte unicode 🌸🚀🛡️ test",
        "Message #4: Consecutive command .menu execution",
        "Message #5: Deep iteration checkpoint"
    ];

    const sequentialTransitions = [];
    for (let i = 0; i < messages.length; i++) {
        const text = messages[i];
        const paddedPlaintext = Buffer.from(text, 'utf-8');

        // Snapshot Alice Before Encrypt
        const aliceRecBefore = (await storeAlice.loadSenderKey(groupName)).serialize();

        // Encrypt
        const skmsgBytes = await cipherAlice.encrypt(paddedPlaintext);

        // Snapshot Alice After Encrypt
        const aliceRecAfter = (await storeAlice.loadSenderKey(groupName)).serialize();

        // Snapshot Bob Before Decrypt
        const bobRecBefore = (await storeBob.loadSenderKey(groupName)).serialize();

        // Decrypt
        const decryptedPlaintext = await cipherBob.decrypt(skmsgBytes);

        // Snapshot Bob After Decrypt
        const bobRecAfter = (await storeBob.loadSenderKey(groupName)).serialize();

        sequentialTransitions.push({
            step: i + 1,
            plaintext_utf8: text,
            plaintext_hex: paddedPlaintext.toString('hex'),
            ciphertext_skmsg_hex: skmsgBytes.toString('hex'),
            ciphertext_skmsg_base64: skmsgBytes.toString('base64'),
            alice_state_before: aliceRecBefore,
            alice_state_after: aliceRecAfter,
            bob_state_before: bobRecBefore,
            bob_state_after: bobRecAfter,
            decrypted_matches_hex: decryptedPlaintext.toString('hex') === paddedPlaintext.toString('hex')
        });
    }
    result.group_cipher_sequential = sequentialTransitions;

    // =========================================================
    // 2. GroupCipher: Out-of-Order & Skipped Message Keys
    // =========================================================
    console.log('2. Building GroupCipher Out-of-Order Vectors...');
    const storeAliceOoo = new InMemorySenderKeyStore();
    const storeBobOoo = new InMemorySenderKeyStore();
    const groupNameOoo = new SenderKeyName("120363423520240855@g.us", "628987654321::1");

    const builderAliceOoo = new GroupSessionBuilder(storeAliceOoo);
    const skdmOoo = await builderAliceOoo.create(groupNameOoo);

    const builderBobOoo = new GroupSessionBuilder(storeBobOoo);
    await builderBobOoo.process(groupNameOoo, skdmOoo);

    const cipherAliceOoo = new GroupCipher(storeAliceOoo, groupNameOoo);
    const cipherBobOoo = new GroupCipher(storeBobOoo, groupNameOoo);

    // Alice produces 5 messages
    const oooPackets = [];
    for (let m = 0; m < 5; m++) {
        const text = `OOO Message #${m}`;
        const buf = Buffer.from(text, 'utf-8');
        const ct = await cipherAliceOoo.encrypt(buf);
        oooPackets.push({ index: m, text, buf, ct });
    }

    // Bob receives in order: #4 (jump!), then #2 (stored skipped), then #0 (stored skipped)
    const oooTransitions = [];
    const arrivalOrder = [4, 2, 0, 1, 3];

    for (const arriveIdx of arrivalOrder) {
        const packet = oooPackets[arriveIdx];
        const bobBefore = (await storeBobOoo.loadSenderKey(groupNameOoo)).serialize();
        const decrypted = await cipherBobOoo.decrypt(packet.ct);
        const bobAfter = (await storeBobOoo.loadSenderKey(groupNameOoo)).serialize();

        oooTransitions.push({
            arrived_message_index: arriveIdx,
            plaintext_utf8: packet.text,
            ciphertext_skmsg_hex: packet.ct.toString('hex'),
            bob_state_before: bobBefore,
            bob_state_after: bobAfter,
            skipped_keys_in_state: bobAfter[0]?.senderMessageKeys?.length || 0,
            decrypted_matches: decrypted.toString('hex') === packet.buf.toString('hex')
        });
    }
    result.group_cipher_out_of_order = oooTransitions;

    // =========================================================
    // 3. GroupSessionBuilder: SKDM Ingestion & Key Rotation
    // =========================================================
    console.log('3. Building GroupSessionBuilder Ingestion Vectors...');
    const storeBuilder = new InMemorySenderKeyStore();
    const gName = new SenderKeyName("120363428437686919@g.us", "628111222333::1");
    const builder = new GroupSessionBuilder(storeBuilder);

    const ingestionVectors = [];
    for (let k = 1; k <= 3; k++) {
        const keyId = 888000 + k;
        const seed = Buffer.alloc(32, k * 19);
        const kp = generateKeypair(k * 23);
        const skdm = new SenderKeyDistributionMessage(keyId, 0, seed, kp.publicKey);
        const skdmBytes = skdm.serialize();

        const beforeState = (await storeBuilder.loadSenderKey(gName)).serialize();
        await builder.process(gName, skdm);
        const afterState = (await storeBuilder.loadSenderKey(gName)).serialize();

        ingestionVectors.push({
            rotation_step: k,
            key_id: keyId,
            skdm_bytes_hex: skdmBytes.toString('hex'),
            skdm_bytes_base64: skdmBytes.toString('base64'),
            record_before: beforeState,
            record_after: afterState,
            total_states_retained: afterState.length
        });
    }
    result.group_session_builder_ingestion = ingestionVectors;

    // =========================================================
    // 4. LidPnMapping: Bi-directional Mapping & Resolution
    // =========================================================
    console.log('4. Building LidPnMapping Vectors...');
    const mappingPairs = [
        { pn: "628123456789@s.whatsapp.net", lid: "100234567890123@lid" },
        { pn: "628987654321@s.whatsapp.net", lid: "200987654321098@lid" },
        { pn: "16505551234@s.whatsapp.net", lid: "300555123400011@lid" }
    ];
    result.lid_pn_mapping = {
        pairs: mappingPairs,
        bulk_lookup_query: mappingPairs.map(x => x.pn),
        reverse_lookup_query: mappingPairs.map(x => x.lid)
    };

    fs.writeFileSync(VECTOR_FILE, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`✅ Level 2 Golden Test Vectors saved successfully to ${VECTOR_FILE}`);
}

buildLevel2Vectors().catch(err => {
    console.error('Vector generation failed:', err);
    process.exit(1);
});
