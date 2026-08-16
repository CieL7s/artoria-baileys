import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_FILE = path.join(__dirname, '../vectors/signal-level2-real-traffic.json');

const loadVectors = () => {
    try {
        if (fs.existsSync(VECTOR_FILE)) {
            const raw = fs.readFileSync(VECTOR_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    } catch {}
    return {
        description: "Level 2 Real-Traffic State-Transition Test Vectors (Live WhatsApp Traffic)",
        schema_version: "2.0.0",
        captured_at: new Date().toISOString(),
        skmsg_state_transitions: [],
        pairwise_state_transitions: [],
        skdm_ingestions: []
    };
};

const saveVectors = (data) => {
    try {
        const dir = path.dirname(VECTOR_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(VECTOR_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('[TRAFFIC_RECORDER_LEVEL2] Failed to save vectors:', err);
    }
};

export const recordLevel2Skmsg = ({ senderKeyName, inputBytes, recordBefore, recordAfter, plaintext, senderKeyMessage, signatureKey }) => {
    try {
        const data = loadVectors();
        if (data.skmsg_state_transitions.length >= 20) return; // Cap at 20

        const inputBuf = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
        const plainBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
        const sigKeyBuf = signatureKey ? (Buffer.isBuffer(signatureKey) ? signatureKey : Buffer.from(signatureKey)) : null;

        const vector = {
            id: `skmsg_transition_${data.skmsg_state_transitions.length + 1}`,
            timestamp: new Date().toISOString(),
            sender_key_name: senderKeyName?.toString(),
            key_id: senderKeyMessage?.getKeyId(),
            iteration: senderKeyMessage?.getIteration(),
            raw_input_base64: inputBuf.toString('base64'),
            raw_input_hex: inputBuf.toString('hex'),
            signature_base64: senderKeyMessage?.signature ? Buffer.from(senderKeyMessage.signature).toString('base64') : null,
            ciphertext_base64: senderKeyMessage?.ciphertext ? Buffer.from(senderKeyMessage.ciphertext).toString('base64') : null,
            public_key_base64: sigKeyBuf ? sigKeyBuf.toString('base64') : null,
            record_state_before: recordBefore ? (typeof recordBefore.serialize === 'function' ? recordBefore.serialize() : recordBefore) : null,
            record_state_after: recordAfter ? (typeof recordAfter.serialize === 'function' ? recordAfter.serialize() : recordAfter) : null,
            expected_plaintext_base64: plainBuf.toString('base64'),
            expected_plaintext_hex: plainBuf.toString('hex'),
            expected_plaintext_length: plainBuf.length
        };

        data.skmsg_state_transitions.push(vector);
        saveVectors(data);
        console.log(`[TRAFFIC_RECORDER_LEVEL2] Captured real SKMSG transition #${data.skmsg_state_transitions.length} (${senderKeyName})`);
    } catch (err) {
        console.error('[TRAFFIC_RECORDER_LEVEL2] Error capturing SKMSG:', err);
    }
};

export const recordLevel2Pairwise = ({ jid, type, inputBytes, plaintext, sessionBefore, sessionAfter, identityKey }) => {
    try {
        const data = loadVectors();
        if (data.pairwise_state_transitions.length >= 20) return; // Cap at 20

        const inputBuf = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
        const plainBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);

        const vector = {
            id: `pairwise_transition_${data.pairwise_state_transitions.length + 1}`,
            timestamp: new Date().toISOString(),
            type,
            jid,
            raw_input_base64: inputBuf.toString('base64'),
            raw_input_hex: inputBuf.toString('hex'),
            identity_key_base64: identityKey ? Buffer.from(identityKey).toString('base64') : null,
            session_state_before: sessionBefore || null,
            session_state_after: sessionAfter || null,
            expected_plaintext_base64: plainBuf.toString('base64'),
            expected_plaintext_hex: plainBuf.toString('hex'),
            expected_plaintext_length: plainBuf.length
        };

        data.pairwise_state_transitions.push(vector);
        saveVectors(data);
        console.log(`[TRAFFIC_RECORDER_LEVEL2] Captured real Pairwise ${type} transition #${data.pairwise_state_transitions.length} (${jid})`);
    } catch (err) {
        console.error('[TRAFFIC_RECORDER_LEVEL2] Error capturing Pairwise:', err);
    }
};

export const recordLevel2Skdm = ({ groupId, authorJid, inputBytes, recordBefore, recordAfter }) => {
    try {
        const data = loadVectors();
        if (data.skdm_ingestions.length >= 10) return;

        const inputBuf = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);

        const vector = {
            id: `skdm_ingest_${data.skdm_ingestions.length + 1}`,
            timestamp: new Date().toISOString(),
            group_id: groupId,
            author_jid: authorJid,
            input_bytes_base64: inputBuf.toString('base64'),
            input_bytes_hex: inputBuf.toString('hex'),
            record_state_before: recordBefore ? (typeof recordBefore.serialize === 'function' ? recordBefore.serialize() : recordBefore) : null,
            record_state_after: recordAfter ? (typeof recordAfter.serialize === 'function' ? recordAfter.serialize() : recordAfter) : null
        };

        data.skdm_ingestions.push(vector);
        saveVectors(data);
        console.log(`[TRAFFIC_RECORDER_LEVEL2] Captured real SKDM ingestion #${data.skdm_ingestions.length} (${groupId})`);
    } catch (err) {
        console.error('[TRAFFIC_RECORDER_LEVEL2] Error capturing SKDM:', err);
    }
};
