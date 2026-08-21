import { decrypt, encrypt } from 'libsignal/src/crypto.js';
import { SenderKeyMessage } from './sender-key-message.js';
import { SenderKeyName } from './sender-key-name.js';
import { SenderKeyRecord } from './sender-key-record.js';
import { SenderKeyState } from './sender-key-state.js';
import { nativeRust as rust } from '../../Utils/native-loader.js';
import { Packr } from 'msgpackr';
const _packr = new Packr({ useRecords: false });
const _unpackr = new Packr({ useRecords: false });
const pack = _packr.pack.bind(_packr);
const unpack = _unpackr.unpack.bind(_unpackr);

// [P1.3 Quick-Fix] Cache traffic recorder import — jangan `await import()` per decrypt (hot path).
// Hanya aktif bila env RECORD_LEVEL2=1, default mati untuk produksi/benchmark.
let _recordLevel2 = null;
let _recordLevel2Loaded = false;
async function getRecordLevel2() {
    if (_recordLevel2Loaded) return _recordLevel2;
    _recordLevel2Loaded = true;
    if (process.env.RECORD_LEVEL2 !== '1') return (_recordLevel2 = null);
    try {
        const mod = await import('../../../test/tools/traffic-recorder-level2.js');
        _recordLevel2 = mod.recordLevel2Skmsg || null;
    } catch {
        _recordLevel2 = null;
    }
    return _recordLevel2;
}
function tryRecordLevel2Sync(payload) {
    if (!_recordLevel2) return;
    try { _recordLevel2(payload); } catch {}
}

export class GroupCipher {
    constructor(senderKeyStore, senderKeyName) {
        this.senderKeyStore = senderKeyStore;
        this.senderKeyName = senderKeyName;
    }
    async encrypt(paddedPlaintext) {
        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
        if (!record) {
            throw new Error('No SenderKeyRecord found for encryption');
        }

        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            // [P1.1] MessagePack (rmp-serde) — binary, smaller but JS pack/unpack slower than native JSON for small records (measured 1.8× slower).
            // Default OFF (JSON faster for 1-state records). Enable via SIGNAL_MSGPACK=1 for large records benchmark.
            const canMsgpack = typeof rust.signalGroupCipherEncryptMsgpack === 'function' && process.env.SIGNAL_MSGPACK === '1';
            if (canMsgpack) {
                try {
                    const recordMp = pack(record.serialize());
                    const res = rust.signalGroupCipherEncryptMsgpack(Buffer.from(recordMp), Buffer.from(paddedPlaintext));
                    const unpacked = unpack(res.recordMsgpack);
                    const updatedRecord = new SenderKeyRecord(unpacked);
                    await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                    return res.ciphertext;
                } catch (err) {
                    // fallback to JSON below
                    if (process.env.DEBUG_MSGPACK) console.warn('[GROUP_CIPHER_MSGPACK_FALLBACK]', err?.message || err);
                }
            }
            try {
                const recordJson = JSON.stringify(record.serialize());
                const res = rust.signalGroupCipherEncrypt(recordJson, Buffer.from(paddedPlaintext));
                const updatedRecord = new SenderKeyRecord(JSON.parse(res.recordJson));
                await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                return res.ciphertext;
            } catch (err) {
                console.warn('[GROUP_CIPHER_RUST_FALLBACK] Native encrypt failed, using JS fallback:', err?.message || err);
            }
        }

        const senderKeyState = record.getSenderKeyState();
        if (!senderKeyState) {
            throw new Error('No session to encrypt message');
        }
        const iteration = senderKeyState.getSenderChainKey().getIteration();
        const senderKey = this.getSenderKey(senderKeyState, iteration === 0 ? 0 : iteration + 1);
        const ciphertext = await this.getCipherText(senderKey.getIv(), senderKey.getCipherKey(), paddedPlaintext);
        const senderKeyMessage = new SenderKeyMessage(senderKeyState.getKeyId(), senderKey.getIteration(), ciphertext, senderKeyState.getSigningKeyPrivate());
        await this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
        return senderKeyMessage.serialize();
    }
    async decrypt(senderKeyMessageBytes) {
        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
        if (!record) {
            throw new Error('No SenderKeyRecord found for decryption');
        }

        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            const canMsgpack = typeof rust.signalGroupCipherDecryptMsgpack === 'function' && process.env.SIGNAL_MSGPACK === '1';
            if (canMsgpack) {
                try {
                    const recordMp = pack(record.serialize());
                    const res = rust.signalGroupCipherDecryptMsgpack(Buffer.from(recordMp), Buffer.from(senderKeyMessageBytes));
                    const unpacked = unpack(res.recordMsgpack);
                    const updatedRecord = new SenderKeyRecord(unpacked);
                    await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                    if (process.env.RECORD_LEVEL2 === '1') {
                        const rec = await getRecordLevel2();
                        if (rec) tryRecordLevel2Sync({
                            senderKeyName: this.senderKeyName,
                            inputBytes: senderKeyMessageBytes,
                            recordBefore: record,
                            recordAfter: updatedRecord,
                            plaintext: res.plaintext,
                            senderKeyMessage: null,
                            signatureKey: null
                        });
                    }
                    return res.plaintext;
                } catch (err) {
                    if (process.env.DEBUG_MSGPACK) console.warn('[GROUP_CIPHER_MSGPACK_FALLBACK]', err?.message || err);
                }
            }
            try {
                const recordJson = JSON.stringify(record.serialize());
                const res = rust.signalGroupCipherDecrypt(recordJson, Buffer.from(senderKeyMessageBytes));
                const updatedRecord = new SenderKeyRecord(JSON.parse(res.recordJson));
                await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                // Level2 recorder — cached, no per-decrypt import. Aktif hanya jika RECORD_LEVEL2=1
                if (process.env.RECORD_LEVEL2 === '1') {
                    const rec = await getRecordLevel2();
                    if (rec) tryRecordLevel2Sync({
                        senderKeyName: this.senderKeyName,
                        inputBytes: senderKeyMessageBytes,
                        recordBefore: record,
                        recordAfter: updatedRecord,
                        plaintext: res.plaintext,
                        senderKeyMessage: null,
                        signatureKey: null
                    });
                }
                return res.plaintext;
            } catch (err) {
                console.warn('[GROUP_CIPHER_RUST_FALLBACK] Native decrypt failed, using JS fallback:', err?.message || err);
            }
        }
        const senderKeyMessage = new SenderKeyMessage(null, null, null, null, senderKeyMessageBytes);
        const senderKeyState = record.getSenderKeyState(senderKeyMessage.getKeyId());
        if (!senderKeyState) {
            throw new Error('No session found to decrypt message');
        }
        const pubKey = senderKeyState.getSigningKeyPublic();
        if (process.env.DEBUG_SKMSG === '1') console.log('[SKMSG_VERIFY_SIGNATURE_DEBUG]', {
            senderKeyName: this.senderKeyName?.toString(),
            keyId: senderKeyMessage.getKeyId(),
            iteration: senderKeyMessage.getIteration(),
            pubKeyBase64: pubKey ? Buffer.from(pubKey).toString('base64') : null,
            pubKeyLength: pubKey?.length,
            signatureLength: senderKeyMessage.signature?.length,
            ciphertextLength: senderKeyMessage.ciphertext?.length,
            serializedLength: senderKeyMessage.serialized?.length
        });
        senderKeyMessage.verifySignature(pubKey);
        const recordSnapshot = new SenderKeyRecord(record.serialize());
        const senderKey = this.getSenderKey(senderKeyState, senderKeyMessage.getIteration());
        const plaintext = await this.getPlainText(senderKey.getIv(), senderKey.getCipherKey(), senderKeyMessage.getCipherText());
        await this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
        if (process.env.RECORD_LEVEL2 === '1') {
            const rec = await getRecordLevel2();
            if (rec) tryRecordLevel2Sync({
                senderKeyName: this.senderKeyName,
                inputBytes: senderKeyMessageBytes,
                recordBefore: recordSnapshot,
                recordAfter: record,
                plaintext,
                senderKeyMessage,
                signatureKey: pubKey
            });
        }
        return plaintext;
    }
    getSenderKey(senderKeyState, iteration) {
        let senderChainKey = senderKeyState.getSenderChainKey();
        if (senderChainKey.getIteration() > iteration) {
            if (senderKeyState.hasSenderMessageKey(iteration)) {
                const messageKey = senderKeyState.removeSenderMessageKey(iteration);
                if (!messageKey) {
                    throw new Error('No sender message key found for iteration');
                }
                return messageKey;
            }
            throw new Error(`Received message with old counter: ${senderChainKey.getIteration()}, ${iteration}`);
        }
        if (iteration - senderChainKey.getIteration() > 2000) {
            throw new Error('Over 2000 messages into the future!');
        }
        while (senderChainKey.getIteration() < iteration) {
            senderKeyState.addSenderMessageKey(senderChainKey.getSenderMessageKey());
            senderChainKey = senderChainKey.getNext();
        }
        senderKeyState.setSenderChainKey(senderChainKey.getNext());
        return senderChainKey.getSenderMessageKey();
    }
    async getPlainText(iv, key, ciphertext) {
        try {
            return decrypt(key, ciphertext, iv);
        }
        catch (e) {
            throw new Error('InvalidMessageException');
        }
    }
    async getCipherText(iv, key, plaintext) {
        try {
            return encrypt(key, plaintext, iv);
        }
        catch (e) {
            throw new Error('InvalidMessageException');
        }
    }

    // [P1.2] Batch APIs — amortisasi FFI tax untuk throughput. Tambahan, bukan pengganti.
    async decryptBatch(senderKeyMessageBytesArray) {
        if (!Array.isArray(senderKeyMessageBytesArray) || senderKeyMessageBytesArray.length === 0) return [];
        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
        if (!record) throw new Error('No SenderKeyRecord found for decryption');
        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust && typeof rust.signalGroupCipherDecryptBatch === 'function';
        if (useRust) {
            try {
                const recordJson = JSON.stringify(record.serialize());
                const cts = senderKeyMessageBytesArray.map(b => Buffer.from(b));
                const res = rust.signalGroupCipherDecryptBatch(recordJson, cts);
                const updatedRecord = new SenderKeyRecord(JSON.parse(res.recordJson));
                await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                return res.plaintexts;
            } catch (err) {
                if (process.env.DEBUG_BATCH) console.warn('[BATCH_DECRYPT_FALLBACK]', err?.message || err);
            }
        }
        // Fallback sequential
        const out = [];
        for (const b of senderKeyMessageBytesArray) out.push(await this.decrypt(b));
        return out;
    }

    async encryptBatch(plaintexts) {
        if (!Array.isArray(plaintexts) || plaintexts.length === 0) return [];
        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
        if (!record) throw new Error('No SenderKeyRecord found for encryption');
        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust && typeof rust.signalGroupCipherEncryptBatch === 'function';
        if (useRust) {
            try {
                const recordJson = JSON.stringify(record.serialize());
                const pts = plaintexts.map(p => Buffer.from(p));
                const res = rust.signalGroupCipherEncryptBatch(recordJson, pts);
                const updatedRecord = new SenderKeyRecord(JSON.parse(res.recordJson));
                await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                return res.ciphertexts;
            } catch (err) {
                if (process.env.DEBUG_BATCH) console.warn('[BATCH_ENCRYPT_FALLBACK]', err?.message || err);
            }
        }
        const out = [];
        for (const p of plaintexts) out.push(await this.encrypt(p));
        return out;
    }
}
//# sourceMappingURL=group_cipher.js.map