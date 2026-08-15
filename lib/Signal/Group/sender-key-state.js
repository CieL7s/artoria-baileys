// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./sender-key-state.legacy.js
import { SenderChainKey } from './sender-chain-key.js';
import { SenderMessageKey } from './sender-message-key.js';
export class SenderKeyState {
    constructor(id, iteration, chainKey, signatureKeyPair, signatureKeyPublic, signatureKeyPrivate, senderKeyStateStructure) {
        this.MAX_MESSAGE_KEYS = 2000;
        if (senderKeyStateStructure) {
            this.senderKeyStateStructure = {
                ...senderKeyStateStructure,
                senderMessageKeys: Array.isArray(senderKeyStateStructure.senderMessageKeys)
                    ? senderKeyStateStructure.senderMessageKeys
                    : []
            };
        }
        else {
            if (signatureKeyPair) {
                signatureKeyPublic = signatureKeyPair.public;
                signatureKeyPrivate = signatureKeyPair.private;
            }
            this.senderKeyStateStructure = {
                senderKeyId: id || 0,
                senderChainKey: {
                    iteration: iteration || 0,
                    seed: Buffer.from(chainKey || [])
                },
                senderSigningKey: {
                    public: Buffer.from(signatureKeyPublic || []),
                    private: Buffer.from(signatureKeyPrivate || [])
                },
                senderMessageKeys: []
            };
        }
    }
    getKeyId() {
        return this.senderKeyStateStructure.senderKeyId;
    }
    getSenderChainKey() {
        return new SenderChainKey(this.senderKeyStateStructure.senderChainKey.iteration, this.senderKeyStateStructure.senderChainKey.seed);
    }
    setSenderChainKey(chainKey) {
        this.senderKeyStateStructure.senderChainKey = {
            iteration: chainKey.getIteration(),
            seed: chainKey.getSeed()
        };
    }
    getSigningKeyPublic() {
        const pub = this.senderKeyStateStructure.senderSigningKey?.public;
        const toBuf = (k) => {
            if (!k) return Buffer.alloc(0);
            if (Buffer.isBuffer(k)) return k;
            if (Array.isArray(k)) return Buffer.from(k);
            if (typeof k === 'string') return Buffer.from(k, 'base64');
            if (k.type === 'Buffer' && typeof k.data === 'string') return Buffer.from(k.data, 'base64');
            if (k.type === 'Buffer' && Array.isArray(k.data)) return Buffer.from(k.data);
            if (k.data) return toBuf(k.data);
            return Buffer.from(k);
        };
        const raw = toBuf(pub);
        if (raw.length === 32) {
            const fixed = Buffer.alloc(33);
            fixed[0] = 0x05;
            raw.copy(fixed, 1);
            return fixed;
        }
        return raw;
    }
    getSigningKeyPrivate() {
        const priv = this.senderKeyStateStructure.senderSigningKey?.private;
        const toBuf = (k) => {
            if (!k) return Buffer.alloc(0);
            if (Buffer.isBuffer(k)) return k;
            if (Array.isArray(k)) return Buffer.from(k);
            if (typeof k === 'string') return Buffer.from(k, 'base64');
            if (k.type === 'Buffer' && typeof k.data === 'string') return Buffer.from(k.data, 'base64');
            if (k.type === 'Buffer' && Array.isArray(k.data)) return Buffer.from(k.data);
            if (k.data) return toBuf(k.data);
            return Buffer.from(k);
        };
        return toBuf(priv);
    }
    hasSenderMessageKey(iteration) {
        return this.senderKeyStateStructure.senderMessageKeys.some(key => key.iteration === iteration);
    }
    addSenderMessageKey(senderMessageKey) {
        this.senderKeyStateStructure.senderMessageKeys.push({
            iteration: senderMessageKey.getIteration(),
            seed: senderMessageKey.getSeed()
        });
        if (this.senderKeyStateStructure.senderMessageKeys.length > this.MAX_MESSAGE_KEYS) {
            this.senderKeyStateStructure.senderMessageKeys.shift();
        }
    }
    removeSenderMessageKey(iteration) {
        const index = this.senderKeyStateStructure.senderMessageKeys.findIndex(key => key.iteration === iteration);
        if (index !== -1) {
            const messageKey = this.senderKeyStateStructure.senderMessageKeys[index];
            this.senderKeyStateStructure.senderMessageKeys.splice(index, 1);
            return new SenderMessageKey(messageKey.iteration, messageKey.seed);
        }
        return null;
    }
    getStructure() {
        return this.senderKeyStateStructure;
    }
}
//# sourceMappingURL=sender-key-state.js.map