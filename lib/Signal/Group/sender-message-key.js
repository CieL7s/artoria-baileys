// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./sender-message-key.legacy.js
import { deriveSecrets } from 'libsignal/src/crypto.js';
import { logShadowComparison, logShadowError } from './shadow_comparator.js';
import { nativeRust as rust } from '../../Utils/native-loader.js';

export class SenderMessageKey {
    constructor(iteration, seed, directIv, directCipherKey) {
        if (directIv && directCipherKey) {
            this.iv = Buffer.from(directIv);
            this.cipherKey = Buffer.from(directCipherKey);
            this.iteration = iteration;
            this.seed = seed;
            return;
        }

        const toBuf = (k) => {
            if (!k) return Buffer.alloc(0);
            if (Buffer.isBuffer(k)) return k;
            if (Array.isArray(k)) return Buffer.from(k);
            if (typeof k === 'string') return Buffer.from(k, 'base64');
            if (k.type === 'Buffer' && Array.isArray(k.data)) return Buffer.from(k.data);
            if (k.type === 'Buffer' && typeof k.data === 'string') return Buffer.from(k.data, 'base64');
            if (k.data) return toBuf(k.data);
            return Buffer.from(k);
        };
        const seedBuf = toBuf(seed);

        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            const res = rust.signalGroupDeriveMessageKey(iteration, seedBuf);
            this.iv = res.iv;
            this.cipherKey = res.cipherKey;
            this.iteration = res.iteration;
            this.seed = res.seed;
            return;
        }

        const derivative = deriveSecrets(seedBuf, Buffer.alloc(32), Buffer.from('WhisperGroup'));
        const keys = new Uint8Array(32);
        keys.set(new Uint8Array(derivative[0].slice(16)));
        keys.set(new Uint8Array(derivative[1].slice(0, 16)), 16);
        this.iv = Buffer.from(derivative[0].slice(0, 16));
        this.cipherKey = Buffer.from(keys.buffer);
        this.iteration = iteration;
        this.seed = seedBuf;

        if (process.env.SIGNAL_SHADOW_MODE === '1') {
            try {
                const rustRes = rust.signalGroupDeriveMessageKey(iteration, seedBuf);
                const isMatch = rustRes.iv.equals(this.iv) && rustRes.cipherKey.equals(this.cipherKey);
                logShadowComparison('SenderMessageKey.constructor', isMatch, {
                    iteration,
                    jsIv: this.iv.toString('hex'),
                    rustIv: rustRes.iv.toString('hex')
                });
            } catch (err) {
                logShadowError('SenderMessageKey.constructor', err);
            }
        }
    }
    getIteration() {
        return this.iteration;
    }
    getIv() {
        return this.iv;
    }
    getCipherKey() {
        return this.cipherKey;
    }
    getSeed() {
        return this.seed;
    }
}
//# sourceMappingURL=sender-message-key.js.map