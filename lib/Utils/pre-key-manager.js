import PQueue from 'p-queue';
import { BufferJSON } from './generics.js';
import { nativeRust } from './native-loader.js';

export class PreKeyManager {
    constructor(store, logger) {
        this.store = store;
        this.logger = logger;
        this.queues = new Map();
    }

    static generateBatch(startId, count) {
        if (nativeRust?.preKeyGenerateBatch) {
            try {
                const raw = nativeRust.preKeyGenerateBatch(startId, count);
                const list = JSON.parse(raw);
                return list.map(item => ({
                    keyId: item.key_id,
                    keyPair: {
                        public: Buffer.from(item.key_pair.public),
                        private: Buffer.from(item.key_pair.private)
                    }
                }));
            } catch {
                return [];
            }
        }
        return [];
    }

    getQueue(keyType) {
        if (!this.queues.has(keyType)) {
            this.queues.set(keyType, new PQueue({ concurrency: 1 }));
        }
        return this.queues.get(keyType);
    }

    async processOperations(data, keyType, transactionCache, mutations, isInTransaction) {
        const keyData = data[keyType];
        if (!keyData) return;

        return this.getQueue(keyType).add(async () => {
            transactionCache[keyType] = transactionCache[keyType] || {};
            mutations[keyType] = mutations[keyType] || {};

            if (nativeRust?.preKeyProcessOperations) {
                let knownKeys = [];
                if (isInTransaction) {
                    knownKeys = Object.keys(transactionCache[keyType]).filter(k => !!transactionCache[keyType][k]);
                } else {
                    const candidateIds = Object.keys(keyData).filter(id => keyData[id] === null);
                    if (candidateIds.length > 0) {
                        const existing = await this.store.get(keyType, candidateIds);
                        knownKeys = Object.keys(existing || {}).filter(k => !!existing?.[k]);
                    }
                }

                let result = null;
                try {
                    const rawResult = nativeRust.preKeyProcessOperations(
                        JSON.stringify(keyData, BufferJSON.replacer),
                        JSON.stringify(knownKeys)
                    );
                    result = JSON.parse(rawResult, BufferJSON.reviver);
                } catch {
                    result = null;
                }

                if (result) {
                    if (result.updates && Object.keys(result.updates).length > 0) {
                        Object.assign(transactionCache[keyType], result.updates);
                        Object.assign(mutations[keyType], result.updates);
                    }

                    if (result.valid_deletions && result.valid_deletions.length > 0) {
                        for (const id of result.valid_deletions) {
                            transactionCache[keyType][id] = null;
                            mutations[keyType][id] = null;
                        }
                    }

                    if (result.skipped_deletions && result.skipped_deletions.length > 0) {
                        for (const id of result.skipped_deletions) {
                            if (isInTransaction) {
                                this.logger.warn(`Skipping deletion of non-existent ${keyType} in transaction: ${id}`);
                            } else {
                                this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${id}`);
                            }
                        }
                    }
                    return;
                }
            }

            const deletions = [];
            const updates = {};
            for (const keyId in keyData) {
                if (keyData[keyId] === null) {
                    deletions.push(keyId);
                } else {
                    updates[keyId] = keyData[keyId];
                }
            }
            if (Object.keys(updates).length > 0) {
                Object.assign(transactionCache[keyType], updates);
                Object.assign(mutations[keyType], updates);
            }
            if (deletions.length > 0) {
                await this.processDeletions(keyType, deletions, transactionCache, mutations, isInTransaction);
            }
        });
    }

    async processDeletions(keyType, ids, transactionCache, mutations, isInTransaction) {
        if (isInTransaction) {
            for (const keyId of ids) {
                if (transactionCache[keyType]?.[keyId]) {
                    transactionCache[keyType][keyId] = null;
                    mutations[keyType][keyId] = null;
                } else {
                    this.logger.warn(`Skipping deletion of non-existent ${keyType} in transaction: ${keyId}`);
                }
            }
        } else {
            const existingKeys = await this.store.get(keyType, ids);
            for (const keyId of ids) {
                if (existingKeys?.[keyId]) {
                    transactionCache[keyType][keyId] = null;
                    mutations[keyType][keyId] = null;
                } else {
                    this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`);
                }
            }
        }
    }

    async validateDeletions(data, keyType) {
        const keyData = data[keyType];
        if (!keyData) return;

        return this.getQueue(keyType).add(async () => {
            const deletionIds = Object.keys(keyData).filter(id => keyData[id] === null);
            if (deletionIds.length === 0) return;

            const existingKeys = await this.store.get(keyType, deletionIds);

            if (nativeRust?.preKeyFilterInvalidDeletions) {
                let filtered = null;
                try {
                    const knownIds = Object.keys(existingKeys || {}).filter(k => !!existingKeys?.[k]);
                    const rawResult = nativeRust.preKeyFilterInvalidDeletions(
                        JSON.stringify(deletionIds),
                        JSON.stringify(knownIds)
                    );
                    filtered = JSON.parse(rawResult);
                } catch {
                    filtered = null;
                }

                if (filtered) {
                    const [, invalidIds] = filtered;
                    for (const keyId of invalidIds) {
                        this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`);
                        delete data[keyType][keyId];
                    }
                    return;
                }
            }

            for (const keyId of deletionIds) {
                if (!existingKeys?.[keyId]) {
                    this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`);
                    delete data[keyType][keyId];
                }
            }
        });
    }
}