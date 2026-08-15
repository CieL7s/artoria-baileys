// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./sender-key-distribution-message.legacy.js
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { proto } from '../../../WAProto/index.js';
import { CiphertextMessage } from './ciphertext-message.js';
import { logShadowComparison, logShadowError } from './shadow_comparator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../../baileys-napi.node'));

export class SenderKeyDistributionMessage extends CiphertextMessage {
    constructor(id, iteration, chainKey, signatureKey, serialized) {
        super();
        if (serialized) {
            const useRust = process.env.SIGNAL_ENGINE === 'rust';
            if (useRust) {
                try {
                    const parsed = rust.signalGroupParseSkdm(Buffer.from(serialized));
                    this.serialized = Buffer.from(serialized);
                    this.id = parsed.id;
                    this.iteration = parsed.iteration;
                    this.chainKey = parsed.chainKey;
                    this.signatureKey = parsed.signatureKey;
                    return;
                } catch (err) {
                    throw new Error(String(err));
                }
            }

            try {
                const message = serialized.slice(1);
                const distributionMessage = proto.SenderKeyDistributionMessage.decode(message).toJSON();
                this.serialized = serialized;
                this.id = distributionMessage.id;
                this.iteration = distributionMessage.iteration;
                this.chainKey =
                    typeof distributionMessage.chainKey === 'string'
                        ? Buffer.from(distributionMessage.chainKey, 'base64')
                        : distributionMessage.chainKey;
                this.signatureKey =
                    typeof distributionMessage.signingKey === 'string'
                        ? Buffer.from(distributionMessage.signingKey, 'base64')
                        : distributionMessage.signingKey;

                if (process.env.SIGNAL_SHADOW_MODE === '1') {
                    try {
                        const rustParsed = rust.signalGroupParseSkdm(Buffer.from(serialized));
                        const isMatch = rustParsed.id === this.id && rustParsed.iteration === this.iteration;
                        logShadowComparison('SenderKeyDistributionMessage.parse', isMatch, {
                            id: this.id,
                            iteration: this.iteration
                        });
                    } catch (err) {
                        logShadowError('SenderKeyDistributionMessage.parse', err);
                    }
                }
            }
            catch (e) {
                throw new Error(String(e));
            }
        }
        else {
            const useRust = process.env.SIGNAL_ENGINE === 'rust';
            if (useRust) {
                this.id = id;
                this.iteration = iteration;
                this.chainKey = Buffer.from(chainKey);
                this.signatureKey = Buffer.from(signatureKey);
                this.serialized = rust.signalGroupCreateSkdm(id, iteration, this.chainKey, this.signatureKey);
                return;
            }

            const version = this.intsToByteHighAndLow(this.CURRENT_VERSION, this.CURRENT_VERSION);
            this.id = id;
            this.iteration = iteration;
            this.chainKey = chainKey;
            this.signatureKey = signatureKey;
            const message = proto.SenderKeyDistributionMessage.encode(proto.SenderKeyDistributionMessage.create({
                id,
                iteration,
                chainKey,
                signingKey: this.signatureKey
            })).finish();
            this.serialized = Buffer.concat([Buffer.from([version]), message]);

            if (process.env.SIGNAL_SHADOW_MODE === '1') {
                try {
                    const rustBytes = rust.signalGroupCreateSkdm(id, iteration, Buffer.from(chainKey), Buffer.from(signatureKey));
                    const isMatch = rustBytes.equals(this.serialized);
                    logShadowComparison('SenderKeyDistributionMessage.create', isMatch, {
                        id,
                        iteration
                    });
                } catch (err) {
                    logShadowError('SenderKeyDistributionMessage.create', err);
                }
            }
        }
    }
    intsToByteHighAndLow(highValue, lowValue) {
        return (((highValue << 4) | lowValue) & 0xff) % 256;
    }
    serialize() {
        return this.serialized;
    }
    getType() {
        return this.SENDERKEY_DISTRIBUTION_TYPE;
    }
    getIteration() {
        return this.iteration;
    }
    getChainKey() {
        return this.chainKey;
    }
    getSignatureKey() {
        return this.signatureKey;
    }
    getId() {
        return this.id;
    }
}
//# sourceMappingURL=sender-key-distribution-message.js.map