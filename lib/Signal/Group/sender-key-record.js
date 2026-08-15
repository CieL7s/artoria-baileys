// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./sender-key-record.legacy.js
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { BufferJSON } from '../../Utils/generics.js';
import { SenderKeyState } from './sender-key-state.js';
import { logShadowComparison, logShadowError } from './shadow_comparator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../../baileys-napi.node'));

export class SenderKeyRecord {
    constructor(serialized) {
        this.MAX_STATES = 5;
        this.senderKeyStates = [];
        if (serialized) {
            for (const structure of serialized) {
                this.senderKeyStates.push(new SenderKeyState(null, null, null, null, null, null, structure));
                if (this.senderKeyStates.length > this.MAX_STATES) {
                    this.senderKeyStates.shift();
                }
            }
        }
    }
    isEmpty() {
        return this.senderKeyStates.length === 0;
    }
    getSenderKeyState(keyId) {
        if (keyId === undefined && this.senderKeyStates.length) {
            return this.senderKeyStates[this.senderKeyStates.length - 1];
        }
        return this.senderKeyStates.find(state => state.getKeyId() === keyId);
    }
    addSenderKeyState(id, iteration, chainKey, signatureKey) {
        this.senderKeyStates.push(new SenderKeyState(id, iteration, chainKey, null, signatureKey));
        if (this.senderKeyStates.length > this.MAX_STATES) {
            this.senderKeyStates.shift();
        }
    }
    setSenderKeyState(id, iteration, chainKey, keyPair) {
        this.senderKeyStates.length = 0;
        this.senderKeyStates.push(new SenderKeyState(id, iteration, chainKey, keyPair));
    }
    serialize() {
        return this.senderKeyStates.map(state => state.getStructure());
    }
    static deserialize(data) {
        if (!data) return new SenderKeyRecord();

        const useRust = process.env.SIGNAL_ENGINE === 'rust';
        if (useRust) {
            try {
                const jsonInput = typeof data === 'string' ? data : JSON.stringify(data);
                const rustJson = rust.signalGroupRecordDeserialize(jsonInput);
                const parsedStates = JSON.parse(rustJson);
                return new SenderKeyRecord(parsedStates);
            } catch {}
        }

        let parsed = data;
        if (Buffer.isBuffer(parsed)) {
            const str = parsed.toString('utf-8');
            try { parsed = JSON.parse(str, BufferJSON.reviver); } catch {}
        } else if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed, BufferJSON.reviver); } catch {}
        } else if (parsed?.type === 'Buffer' && Array.isArray(parsed.data)) {
            const str = Buffer.from(parsed.data).toString('utf-8');
            try { parsed = JSON.parse(str, BufferJSON.reviver); } catch {}
        }

        const jsRecord = Array.isArray(parsed) ? new SenderKeyRecord(parsed) : new SenderKeyRecord();

        if (process.env.SIGNAL_SHADOW_MODE === '1') {
            try {
                const jsonInput = typeof data === 'string' ? data : JSON.stringify(data);
                const rustJson = rust.signalGroupRecordDeserialize(jsonInput);
                const rustStates = JSON.parse(rustJson);
                const isMatch = rustStates.length === jsRecord.senderKeyStates.length;
                logShadowComparison('SenderKeyRecord.deserialize', isMatch, {
                    jsCount: jsRecord.senderKeyStates.length,
                    rustCount: rustStates.length
                });
            } catch (err) {
                logShadowError('SenderKeyRecord.deserialize', err);
            }
        }

        return jsRecord;
    }
}
//# sourceMappingURL=sender-key-record.js.map