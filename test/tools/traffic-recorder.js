import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_FILE = path.join(__dirname, '../vectors/signal-group-real-traffic.json');

const loadVectors = () => {
    try {
        if (fs.existsSync(VECTOR_FILE)) {
            const raw = fs.readFileSync(VECTOR_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    } catch {}
    return {
        description: "Full Golden Reference Vectors from Live WhatsApp Traffic (Ciphertext, Keys, Plaintexts)",
        version: "2.0.0",
        captured_at: new Date().toISOString(),
        skmsg_vectors: [],
        pkmsg_msg_vectors: [],
        skdm_vectors: []
    };
};

const saveVectors = (data) => {
    try {
        const dir = path.dirname(VECTOR_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(VECTOR_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('[TRAFFIC_RECORDER] Failed to save vectors:', err);
    }
};

export const recordSkmsg = ({ senderKeyName, inputBytes, recordBefore, plaintext, senderKeyMessage, signatureKey }) => {
    try {
        const data = loadVectors();
        if (data.skmsg_vectors.length >= 10) return; // Cap at 10

        const inputBuf = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
        const plainBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
        const sigKeyBuf = signatureKey ? (Buffer.isBuffer(signatureKey) ? signatureKey : Buffer.from(signatureKey)) : null;

        const vector = {
            id: `skmsg_live_${data.skmsg_vectors.length + 1}`,
            timestamp: new Date().toISOString(),
            sender_key_name: senderKeyName?.toString(),
            key_id: senderKeyMessage?.getKeyId(),
            iteration: senderKeyMessage?.getIteration(),
            raw_input_base64: inputBuf.toString('base64'),
            raw_input_length: inputBuf.length,
            signature_base64: senderKeyMessage?.signature ? Buffer.from(senderKeyMessage.signature).toString('base64') : null,
            ciphertext_base64: senderKeyMessage?.ciphertext ? Buffer.from(senderKeyMessage.ciphertext).toString('base64') : null,
            public_key_base64: sigKeyBuf ? sigKeyBuf.toString('base64') : null,
            public_key_length: sigKeyBuf?.length,
            session_state_snapshot: recordBefore ? recordBefore.serialize() : null,
            expected_plaintext_base64: plainBuf.toString('base64'),
            expected_plaintext_hex: plainBuf.toString('hex'),
            expected_plaintext_length: plainBuf.length
        };

        data.skmsg_vectors.push(vector);
        saveVectors(data);
        console.log(`[TRAFFIC_RECORDER] Captured SKMSG vector #${data.skmsg_vectors.length} (${senderKeyName})`);
    } catch (err) {
        console.error('[TRAFFIC_RECORDER] Error capturing SKMSG:', err);
    }
};

export const recordPairwise = ({ jid, type, inputBytes, plaintext, sessionBefore }) => {
    try {
        const data = loadVectors();
        if (data.pkmsg_msg_vectors.length >= 10) return;

        const inputBuf = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
        const plainBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);

        const vector = {
            id: `pairwise_live_${data.pkmsg_msg_vectors.length + 1}`,
            timestamp: new Date().toISOString(),
            type,
            jid,
            raw_input_base64: inputBuf.toString('base64'),
            raw_input_length: inputBuf.length,
            session_snapshot: sessionBefore || null,
            expected_plaintext_base64: plainBuf.toString('base64'),
            expected_plaintext_hex: plainBuf.toString('hex'),
            expected_plaintext_length: plainBuf.length
        };

        data.pkmsg_msg_vectors.push(vector);
        saveVectors(data);
        console.log(`[TRAFFIC_RECORDER] Captured Pairwise ${type} vector #${data.pkmsg_msg_vectors.length} (${jid})`);
    } catch (err) {
        console.error('[TRAFFIC_RECORDER] Error capturing Pairwise:', err);
    }
};

export const recordSkdm = ({ groupId, authorJid, inputBytes, recordAfter }) => {
    try {
        const data = loadVectors();
        if (data.skdm_vectors.length >= 5) return;

        const inputBuf = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);

        const vector = {
            id: `skdm_live_${data.skdm_vectors.length + 1}`,
            timestamp: new Date().toISOString(),
            group_id: groupId,
            author_jid: authorJid,
            raw_input_base64: inputBuf.toString('base64'),
            raw_input_length: inputBuf.length,
            record_snapshot: recordAfter ? recordAfter.serialize() : null
        };

        data.skdm_vectors.push(vector);
        saveVectors(data);
        console.log(`[TRAFFIC_RECORDER] Captured SKDM vector #${data.skdm_vectors.length} (${groupId})`);
    } catch (err) {
        console.error('[TRAFFIC_RECORDER] Error capturing SKDM:', err);
    }
};
