// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./sender-key-message.legacy.js
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateSignature, verifySignature } from 'libsignal/src/curve.js';
import { proto } from '../../../WAProto/index.js';
import { CiphertextMessage } from './ciphertext-message.js';
import { logShadowComparison, logShadowError } from './shadow_comparator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../../baileys-napi.node'));

export class SenderKeyMessage extends CiphertextMessage {
    constructor(keyId, iteration, ciphertext, signatureKey, serialized) {
        super();
        this.SIGNATURE_LENGTH = 64;
        if (serialized) {
            const useRust = process.env.SIGNAL_ENGINE === 'rust';
            if (useRust) {
                const parsed = rust.signalGroupParseSenderKeyMessage(Buffer.from(serialized));
                this.serialized = Buffer.from(serialized);
                this.messageVersion = parsed.message_version;
                this.keyId = parsed.key_id;
                this.iteration = parsed.iteration;
                this.ciphertext = parsed.ciphertext;
                this.signature = parsed.signature;
                return;
            }

            const version = serialized[0];
            const message = serialized.slice(1, serialized.length - this.SIGNATURE_LENGTH);
            const signature = serialized.slice(-1 * this.SIGNATURE_LENGTH);
            const senderKeyMessage = proto.SenderKeyMessage.decode(message).toJSON();
            this.serialized = serialized;
            this.messageVersion = (version & 0xff) >> 4;
            this.keyId = senderKeyMessage.id;
            this.iteration = senderKeyMessage.iteration;
            this.ciphertext =
                typeof senderKeyMessage.ciphertext === 'string'
                    ? Buffer.from(senderKeyMessage.ciphertext, 'base64')
                    : senderKeyMessage.ciphertext;
            this.signature = signature;

            if (process.env.SIGNAL_SHADOW_MODE === '1') {
                try {
                    const rustParsed = rust.signalGroupParseSenderKeyMessage(Buffer.from(serialized));
                    const rustKeyId = rustParsed.keyId ?? rustParsed.key_id;
                    const rustIter = rustParsed.iteration;
                    const isMatch = rustKeyId === this.keyId && rustIter === this.iteration;
                    logShadowComparison('SenderKeyMessage.parse', isMatch, {
                        jsKeyId: this.keyId,
                        rustKeyId,
                        jsIteration: this.iteration,
                        rustIteration: rustIter
                    });
                } catch (err) {
                    logShadowError('SenderKeyMessage.parse', err);
                }
            }
        }
        else {
            const useRust = process.env.SIGNAL_ENGINE === 'rust';
            if (useRust) {
                const privBuf = Buffer.isBuffer(signatureKey) ? signatureKey : Buffer.from(signatureKey);
                const cipherBuf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
                this.serialized = rust.signalGroupCreateSenderKeyMessage(keyId, iteration, cipherBuf, privBuf);
                this.messageVersion = this.CURRENT_VERSION;
                this.keyId = keyId;
                this.iteration = iteration;
                this.ciphertext = cipherBuf;
                this.signature = this.serialized.slice(-1 * this.SIGNATURE_LENGTH);
                return;
            }

            const version = (((this.CURRENT_VERSION << 4) | this.CURRENT_VERSION) & 0xff) % 256;
            const ciphertextBuffer = Buffer.from(ciphertext);
            const message = proto.SenderKeyMessage.encode(proto.SenderKeyMessage.create({
                id: keyId,
                iteration: iteration,
                ciphertext: ciphertextBuffer
            })).finish();
            const signature = this.getSignature(signatureKey, Buffer.concat([Buffer.from([version]), message]));
            this.serialized = Buffer.concat([Buffer.from([version]), message, Buffer.from(signature)]);
            this.messageVersion = this.CURRENT_VERSION;
            this.keyId = keyId;
            this.iteration = iteration;
            this.ciphertext = ciphertextBuffer;
            this.signature = signature;
        }
    }
    getKeyId() {
        return this.keyId;
    }
    getIteration() {
        return this.iteration;
    }
    getCipherText() {
        return this.ciphertext;
    }
    verifySignature(signatureKey) {
        const useRust = process.env.SIGNAL_ENGINE === 'rust';
        if (useRust) {
            const isValid = rust.signalGroupVerifySenderKeyMessage(Buffer.from(this.serialized), Buffer.from(signatureKey));
            if (!isValid) {
                throw new Error('Invalid signature!');
            }
            return;
        }

        const part1 = this.serialized.slice(0, this.serialized.length - this.SIGNATURE_LENGTH);
        const part2 = this.serialized.slice(-1 * this.SIGNATURE_LENGTH);
        // NOTE: libsignal's curve.verifySignature() returns void (undefined) on success
        // and strictly throws an Error on any invalid/corrupted/tampered signature.
        verifySignature(signatureKey, part1, part2);

        if (process.env.SIGNAL_SHADOW_MODE === '1') {
            try {
                const isRustValid = rust.signalGroupVerifySenderKeyMessage(Buffer.from(this.serialized), Buffer.from(signatureKey));
                logShadowComparison('SenderKeyMessage.verifySignature', isRustValid, {
                    keyId: this.keyId
                });
            } catch (err) {
                logShadowError('SenderKeyMessage.verifySignature', err);
            }
        }
    }
    getSignature(signatureKey, serialized) {
        return Buffer.from(calculateSignature(signatureKey, serialized));
    }
    serialize() {
        return this.serialized;
    }
    getType() {
        return 4;
    }
}
//# sourceMappingURL=sender-key-message.js.map