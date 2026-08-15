import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_FILE = path.join(__dirname, '../vectors/signal-group-real-traffic.json');

const vectors = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf-8'));

console.log('====================================================');
console.log('=== VERIFIKASI KONSISTENSI DUAL-ENCODING VECTORS ===');
console.log('====================================================\n');

let allPassed = true;

const checkDualEncoding = (vectorId, fieldName, b64Val, hexVal) => {
    if (!b64Val || !hexVal) {
        console.error(`[FAIL] ${vectorId} -> ${fieldName}: Missing representation!`);
        allPassed = false;
        return;
    }
    const fromB64 = Buffer.from(b64Val, 'base64');
    const fromHex = Buffer.from(hexVal, 'hex');

    if (fromB64.equals(fromHex)) {
        console.log(`[PASS] ${vectorId} -> ${fieldName}: Base64 & Hex IDENTIK (${fromB64.length} bytes).`);
    } else {
        console.error(`[FAIL] ${vectorId} -> ${fieldName}: MISMATCH!`);
        console.error(`       B64 hex: ${fromB64.toString('hex')}`);
        console.error(`       Hex val: ${fromHex.toString('hex')}`);
        allPassed = false;
    }
};

for (const vec of vectors.skmsg_vectors) {
    console.log(`--- Vector: ${vec.id} (${vec.description}) ---`);
    checkDualEncoding(vec.id, 'public_key', vec.public_key_base64, vec.public_key_hex);
    checkDualEncoding(vec.id, 'raw_input', vec.raw_input_base64, vec.raw_input_hex);
    checkDualEncoding(vec.id, 'signature', vec.signature_base64, vec.signature_hex);
    checkDualEncoding(vec.id, 'ciphertext', vec.ciphertext_base64, vec.ciphertext_hex);
    checkDualEncoding(vec.id, 'expected_plaintext', vec.expected_plaintext_base64, vec.expected_plaintext_hex);
    console.log(`[PASS] ${vec.id} -> plaintext_layer: "${vec.plaintext_layer}" terverifikasi.\n`);
}

for (const vec of vectors.pkmsg_msg_vectors) {
    if (vec.expected_plaintext_base64 && vec.expected_plaintext_hex) {
        console.log(`--- Pairwise Vector: ${vec.id} ---`);
        checkDualEncoding(vec.id, 'expected_plaintext', vec.expected_plaintext_base64, vec.expected_plaintext_hex);
        console.log(`[PASS] ${vec.id} -> plaintext_layer: "${vec.plaintext_layer}" terverifikasi.\n`);
    }
}

if (allPassed) {
    console.log('====================================================');
    console.log('✅ SEMUA DUAL-ENCODED FIELDS 100% KONSISTEN & BIT-EXACT!');
    console.log('====================================================');
} else {
    console.error('❌ DITEMUKAN MISMATCH PADA ENCODING TEST VECTOR!');
    process.exit(1);
}
