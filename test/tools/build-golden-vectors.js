import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SenderKeyRecord } from '../../lib/Signal/Group/sender-key-record.js';
import { SenderKeyMessage } from '../../lib/Signal/Group/sender-key-message.js';
import { GroupCipher } from '../../lib/Signal/Group/group_cipher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, '../vectors/signal-group-real-traffic.json');

// Real Auth State records from auth_info_baileys
const AUTH_DIR = path.resolve(__dirname, '../../../test-auriel-baileys/Artoria-MD/auth_info_baileys');

const readAuthState = (filename) => {
    try {
        const filePath = path.join(AUTH_DIR, filename);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) {
        console.error('Error reading auth state:', e);
    }
    return null;
};

// 1. Build test vectors for SenderKey ratchet, state & message parsing
const sampleSeed1 = Buffer.from([239,39,57,112,191,14,30,207,160,232,94,71,225,180,248,141,6,52,7,197,233,118,172,227,179,32,184,185,180,133,67,106]);
const samplePubKey1 = Buffer.from([5,68,216,99,164,88,50,255,231,250,29,194,30,207,174,40,255,188,37,203,128,205,251,39,221,1,233,151,31,155,190,193,66]);

const realSenderKeyFile1 = readAuthState('sender-key-120363409742668546@g.us--202950408405214_1--0.json');
const realSenderKeyFile2 = readAuthState('sender-key-120363423520240855@g.us--202950408405214_1--0.json');
const realSenderKeyFile3 = readAuthState('sender-key-120363409742668546@g.us--132598911267037_1--49.json');
const realSenderKeyFile4 = readAuthState('sender-key-120363423520240855@g.us--49456699420892_1--0.json');
const realSenderKeyFile5 = readAuthState('sender-key-120363409742668546@g.us--202950408405214_1--35.json');

const vectors = {
    description: "Full Golden Reference Test Vectors from Real WhatsApp Traffic (Ciphertext, Keys, Session States, Plaintexts)",
    version: "2.0.0",
    created_at: new Date().toISOString(),
    skmsg_vectors: [
        {
            id: "skmsg_real_01",
            description: "Live Group message (.menu) from 202950408405214 in group 120363409742668546@g.us",
            sender_key_name: "120363409742668546@g.us::202950408405214_1::0",
            key_id: 1807222806,
            iteration: 0,
            public_key_base64: "BUTYY6RYMv/n+h3CHs+uKP+8JcuAzfsn3QHplx+bvsFC",
            public_key_hex: "0544d863a45832ffe7fa1dc21ecfae28ffbc25cb80cdfb27dd01e9971f9bbec142",
            session_state_snapshot: realSenderKeyFile1,
            expected_plaintext_command: ".menu",
            expected_plaintext_hex: "0a052e6d656e75"
        },
        {
            id: "skmsg_real_02",
            description: "Live Group message (.ping) from 202950408405214 in group 120363409742668546@g.us",
            sender_key_name: "120363409742668546@g.us::202950408405214_1::0",
            key_id: 1807222806,
            iteration: 1,
            public_key_base64: "BUTYY6RYMv/n+h3CHs+uKP+8JcuAzfsn3QHplx+bvsFC",
            public_key_hex: "0544d863a45832ffe7fa1dc21ecfae28ffbc25cb80cdfb27dd01e9971f9bbec142",
            session_state_snapshot: realSenderKeyFile1,
            expected_plaintext_command: ".ping",
            expected_plaintext_hex: "0a052e70696e67"
        },
        {
            id: "skmsg_real_03",
            description: "Live Group message (.speed) from 202950408405214 in group 120363409742668546@g.us",
            sender_key_name: "120363409742668546@g.us::202950408405214_1::0",
            key_id: 1807222806,
            iteration: 2,
            public_key_base64: "BUTYY6RYMv/n+h3CHs+uKP+8JcuAzfsn3QHplx+bvsFC",
            public_key_hex: "0544d863a45832ffe7fa1dc21ecfae28ffbc25cb80cdfb27dd01e9971f9bbec142",
            session_state_snapshot: realSenderKeyFile1,
            expected_plaintext_command: ".speed",
            expected_plaintext_hex: "0a062e7370656564"
        },
        {
            id: "skmsg_real_04",
            description: "Live Group message from 132598911267037 in group 120363409742668546@g.us",
            sender_key_name: "120363409742668546@g.us::132598911267037_1::49",
            key_id: 931025688,
            iteration: 1978,
            public_key_base64: "BVTYjZvCGCn6vwS5mwDCF/yXGLnIu6SbgJRwRB6m1z5M",
            public_key_hex: "0554d88d9bc21829fabf04b99b00c217fc9718b9c8bba49b809470441ea6d73e4c",
            session_state_snapshot: realSenderKeyFile3,
            expected_plaintext_topic: "eval owner execution"
        },
        {
            id: "skmsg_real_05",
            description: "Live Group message from 49456699420892 in group 120363423520240855@g.us",
            sender_key_name: "120363423520240855@g.us::49456699420892_1::0",
            key_id: 1401283167,
            iteration: 14,
            public_key_base64: "BZrBuc6S/RIqeNwLhryBKG1vTHNlpNbyYX7ltL5CfVQO",
            public_key_hex: "059ac1b9ce92fd122a78dc0b86bc81286d6f4c7365a4d6f2617ee5b4be427d540e",
            session_state_snapshot: realSenderKeyFile4,
            expected_plaintext_topic: "natural conversation"
        }
    ],
    pkmsg_msg_vectors: [
        {
            id: "pkmsg_real_01",
            type: "pkmsg",
            jid: "5046586634368@lid",
            bytes_length: 1400,
            expected_plaintext_content: "jir ipad",
            expected_plaintext_hex: "0a086a69722069706164"
        },
        {
            id: "msg_real_02",
            type: "msg",
            jid: "132598911267037@lid",
            session_id: "132598911267037_1.0",
            bytes_length: 227
        },
        {
            id: "msg_real_03",
            type: "msg",
            jid: "202950408405214@lid",
            session_id: "202950408405214_1.0",
            bytes_length: 195
        },
        {
            id: "msg_real_04",
            type: "msg",
            jid: "202950408405214@lid",
            session_id: "202950408405214_1.0",
            bytes_length: 291
        },
        {
            id: "msg_real_05",
            type: "msg",
            jid: "132598911267037:49@lid",
            session_id: "132598911267037_1.49",
            bytes_length: 179
        }
    ],
    skdm_vectors: [
        {
            id: "skdm_real_01",
            group_id: "120363409742668546@g.us",
            sender_key_name: "120363409742668546@g.us::202950408405214_1::0",
            key_id: 1807222806,
            iteration: 0,
            record_snapshot: realSenderKeyFile1
        },
        {
            id: "skdm_real_02",
            group_id: "120363423520240855@g.us",
            sender_key_name: "120363423520240855@g.us::202950408405214_1::0",
            key_id: 721456752,
            iteration: 0,
            record_snapshot: realSenderKeyFile2
        }
    ]
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(vectors, null, 2), 'utf-8');
console.log(`[GOLDEN_BUILDER] Successfully built golden test vectors to ${OUTPUT_FILE}`);
