// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./sender-chain-key.legacy.js
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateMAC } from 'libsignal/src/crypto.js';
import { SenderMessageKey } from './sender-message-key.js';
import { logShadowComparison, logShadowError } from './shadow_comparator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../../baileys-napi.node'));

export class SenderChainKey {
    constructor(iteration, chainKey) {
        this.MESSAGE_KEY_SEED = Buffer.from([0x01]);
        this.CHAIN_KEY_SEED = Buffer.from([0x02]);
        this.iteration = iteration;
        this.chainKey = Buffer.from(chainKey);
    }
    getIteration() {
        return this.iteration;
    }
    getSenderMessageKey() {
        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            const res = rust.signalGroupChainKeyGetMessageKey(this.iteration, this.chainKey);
            return new SenderMessageKey(res.iteration, res.seed, res.iv, res.cipherKey);
        }

        const jsResult = new SenderMessageKey(this.iteration, this.getDerivative(this.MESSAGE_KEY_SEED, this.chainKey));
        if (process.env.SIGNAL_SHADOW_MODE === '1') {
            try {
                const rustRes = rust.signalGroupChainKeyGetMessageKey(this.iteration, this.chainKey);
                const isMatch = rustRes.iv.equals(jsResult.getIv()) && rustRes.cipherKey.equals(jsResult.getCipherKey());
                logShadowComparison('SenderChainKey.getSenderMessageKey', isMatch, {
                    iteration: this.iteration,
                    jsIv: jsResult.getIv().toString('hex'),
                    rustIv: rustRes.iv.toString('hex')
                });
            } catch (err) {
                logShadowError('SenderChainKey.getSenderMessageKey', err);
            }
        }
        return jsResult;
    }
    getNext() {
        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            const res = rust.signalGroupChainKeyNext(this.iteration, this.chainKey);
            return new SenderChainKey(res.iteration, res.seed);
        }

        const jsResult = new SenderChainKey(this.iteration + 1, this.getDerivative(this.CHAIN_KEY_SEED, this.chainKey));
        if (process.env.SIGNAL_SHADOW_MODE === '1') {
            try {
                const rustRes = rust.signalGroupChainKeyNext(this.iteration, this.chainKey);
                const isMatch = rustRes.iteration === jsResult.getIteration() && rustRes.seed.equals(jsResult.getSeed());
                logShadowComparison('SenderChainKey.getNext', isMatch, {
                    iteration: this.iteration,
                    jsSeed: jsResult.getSeed().toString('hex'),
                    rustSeed: rustRes.seed.toString('hex')
                });
            } catch (err) {
                logShadowError('SenderChainKey.getNext', err);
            }
        }
        return jsResult;
    }
    getSeed() {
        return this.chainKey;
    }
    getDerivative(seed, key) {
        return calculateMAC(key, seed);
    }
}
//# sourceMappingURL=sender-chain-key.js.map