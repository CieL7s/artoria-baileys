import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { decrypt, encrypt } from 'libsignal/src/crypto.js';
import { SenderKeyMessage } from './sender-key-message.js';
import { SenderKeyName } from './sender-key-name.js';
import { SenderKeyRecord } from './sender-key-record.js';
import { SenderKeyState } from './sender-key-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../../baileys-napi.node'));

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

        const useRust = process.env.SIGNAL_ENGINE === 'rust';
        if (useRust) {
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

        const useRust = process.env.SIGNAL_ENGINE === 'rust';
        if (useRust) {
            try {
                const recordJson = JSON.stringify(record.serialize());
                const res = rust.signalGroupCipherDecrypt(recordJson, Buffer.from(senderKeyMessageBytes));
                const updatedRecord = new SenderKeyRecord(JSON.parse(res.recordJson));
                await this.senderKeyStore.storeSenderKey(this.senderKeyName, updatedRecord);
                try {
                    const { recordLevel2Skmsg } = await import('../../../test/tools/traffic-recorder-level2.js');
                    recordLevel2Skmsg({
                        senderKeyName: this.senderKeyName,
                        inputBytes: senderKeyMessageBytes,
                        recordBefore: record,
                        recordAfter: updatedRecord,
                        plaintext: res.plaintext,
                        senderKeyMessage: null,
                        signatureKey: null
                    });
                } catch {}
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
        console.log('[SKMSG_VERIFY_SIGNATURE_DEBUG]', {
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
        try {
            const { recordLevel2Skmsg } = await import('../../../test/tools/traffic-recorder-level2.js');
            recordLevel2Skmsg({
                senderKeyName: this.senderKeyName,
                inputBytes: senderKeyMessageBytes,
                recordBefore: recordSnapshot,
                recordAfter: record,
                plaintext,
                senderKeyMessage,
                signatureKey: pubKey
            });
        } catch {}
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
}
//# sourceMappingURL=group_cipher.js.map