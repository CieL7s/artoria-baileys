import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SenderKeyRecord } from '../../lib/Signal/Group/sender-key-record.js';
import { SenderKeyName } from '../../lib/Signal/Group/sender-key-name.js';
import { GroupCipher } from '../../lib/Signal/Group/group_cipher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_FILE = path.join(__dirname, '../vectors/signal-group-real-traffic.json');

const vectors = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf-8'));
const targetVector = vectors.skmsg_vectors.find(v => v.id === 'skmsg_real_01');

if (!targetVector) {
    console.error('Vector skmsg_real_01 not found!');
    process.exit(1);
}

console.log('====================================================');
console.log('=== DRY-RUN REPLAY MANUAL: SKMSG_REAL_01 (.MENU) ===');
console.log('====================================================\n');

console.log('1. Loading Vector Metadata & Cryptographic Payload:');
console.log('   - ID:', targetVector.id);
console.log('   - SenderKeyName:', targetVector.sender_key_name);
console.log('   - Key ID:', targetVector.key_id);
console.log('   - Iteration:', targetVector.iteration);
console.log('   - Raw Input Length:', Buffer.from(targetVector.raw_input_hex, 'hex').length, 'bytes');
console.log('   - Public Key Hex:', targetVector.public_key_hex);
console.log('   - Expected Plaintext Hex:', targetVector.expected_plaintext_hex);
console.log('   - Plaintext Layer:', targetVector.plaintext_layer);

// 2. Setup isolated in-memory store
const inMemoryStore = {
    records: new Map(),
    async loadSenderKey(senderKeyName) {
        const key = senderKeyName.toString();
        const record = this.records.get(key);
        return record ? new SenderKeyRecord(record.serialize()) : null;
    },
    async storeSenderKey(senderKeyName, record) {
        this.records.set(senderKeyName.toString(), new SenderKeyRecord(record.serialize()));
    }
};

async function runDryRun() {
    const senderKeyName = new SenderKeyName('120363409742668546@g.us', '202950408405214_1::0');
    
    // Instantiate SenderKeyRecord strictly from the session_state_snapshot in the JSON vector
    const initialRecord = new SenderKeyRecord(targetVector.session_state_snapshot);
    await inMemoryStore.storeSenderKey(senderKeyName, initialRecord);

    console.log('\n2. Replaying GroupCipher.decrypt() in Total Isolation:');
    const groupCipher = new GroupCipher(inMemoryStore, senderKeyName);
    const rawCiphertextBuffer = Buffer.from(targetVector.raw_input_hex, 'hex');

    const decryptedBuffer = await groupCipher.decrypt(rawCiphertextBuffer);
    const expectedBuffer = Buffer.from(targetVector.expected_plaintext_hex, 'hex');

    console.log('\n3. Output Verification:');
    console.log('   - Actual Decrypted Plaintext Hex:  ', decryptedBuffer.toString('hex'));
    console.log('   - Expected Plaintext Hex:          ', targetVector.expected_plaintext_hex);
    console.log('   - Protobuf Delimited Tag (Field 1):', '0x' + decryptedBuffer.slice(0, 1).toString('hex'));
    console.log('   - Protobuf Length Delimiter:       ', decryptedBuffer[1], 'bytes');
    console.log('   - Decoded Text String:             ', decryptedBuffer.slice(2).toString('utf-8'));

    const isMatch = decryptedBuffer.equals(expectedBuffer);
    console.log('\n4. Result:');
    if (isMatch) {
        console.log('====================================================');
        console.log('✅ DRY-RUN REPLAY 100% SUKSES! Bit-for-bit IDENTIK.');
        console.log('====================================================');
    } else {
        console.error('❌ DRY-RUN REPLAY GAGAL! Output tidak sesuai.');
        process.exit(1);
    }
}

runDryRun().catch(console.error);
