import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import * as keyhelper from './keyhelper.js';
import { SenderKeyDistributionMessage } from './sender-key-distribution-message.js';
import { SenderKeyName } from './sender-key-name.js';
import { SenderKeyRecord } from './sender-key-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../../baileys-napi.node'));

export class GroupSessionBuilder {
    constructor(senderKeyStore) {
        this.senderKeyStore = senderKeyStore;
    }
    async process(senderKeyName, senderKeyDistributionMessage) {
        const senderKeyRecord = await this.senderKeyStore.loadSenderKey(senderKeyName);

        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            try {
                const recordJson = JSON.stringify(senderKeyRecord.serialize());
                const updatedJson = rust.signalGroupSessionBuilderProcess(recordJson, Buffer.from(senderKeyDistributionMessage.serialize()));
                const updatedRecord = new SenderKeyRecord(JSON.parse(updatedJson));
                await this.senderKeyStore.storeSenderKey(senderKeyName, updatedRecord);
                return;
            } catch (err) {
                console.warn('[GROUP_BUILDER_RUST_FALLBACK] Native process failed, using JS fallback:', err?.message || err);
            }
        }

        senderKeyRecord.addSenderKeyState(senderKeyDistributionMessage.getId(), senderKeyDistributionMessage.getIteration(), senderKeyDistributionMessage.getChainKey(), senderKeyDistributionMessage.getSignatureKey());
        await this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord);
    }
    async create(senderKeyName) {
        const senderKeyRecord = await this.senderKeyStore.loadSenderKey(senderKeyName);

        const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
        if (useRust) {
            try {
                const recordJson = JSON.stringify(senderKeyRecord.serialize());
                const res = rust.signalGroupSessionBuilderCreate(recordJson);
                const updatedRecord = new SenderKeyRecord(JSON.parse(res.recordJson));
                await this.senderKeyStore.storeSenderKey(senderKeyName, updatedRecord);
                return new SenderKeyDistributionMessage(null, null, null, null, res.skdmBytes);
            } catch (err) {
                console.warn('[GROUP_BUILDER_RUST_FALLBACK] Native create failed, using JS fallback:', err?.message || err);
            }
        }

        if (senderKeyRecord.isEmpty()) {
            const keyId = keyhelper.generateSenderKeyId();
            const senderKey = keyhelper.generateSenderKey();
            const signingKey = keyhelper.generateSenderSigningKey();
            senderKeyRecord.setSenderKeyState(keyId, 0, senderKey, signingKey);
            await this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord);
        }
        const state = senderKeyRecord.getSenderKeyState();
        if (!state) {
            throw new Error('No session state available');
        }
        return new SenderKeyDistributionMessage(state.getKeyId(), state.getSenderChainKey().getIteration(), state.getSenderChainKey().getSeed(), state.getSigningKeyPublic());
    }
}
//# sourceMappingURL=group-session-builder.js.map