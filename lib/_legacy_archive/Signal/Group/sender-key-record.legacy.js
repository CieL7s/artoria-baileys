import { BufferJSON } from '../../Utils/generics.js';
import { SenderKeyState } from './sender-key-state.js';
export class SenderKeyRecord {
    constructor(serialized) {
        this.MAX_STATES = 5;
        this.senderKeyStates = [];
        if (serialized) {
            for (const structure of serialized) {
                this.senderKeyStates.push(new SenderKeyState(null, null, null, null, null, null, structure));
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
        if (Array.isArray(parsed)) {
            return new SenderKeyRecord(parsed);
        }
        return new SenderKeyRecord();
    }
}
//# sourceMappingURL=sender-key-record.js.map