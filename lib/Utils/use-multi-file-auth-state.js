import { Mutex } from 'async-mutex';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { proto } from '../../WAProto/index.js';
import { initAuthCreds } from './auth-utils.js';
import { BufferJSON } from './generics.js';
import { nativeRust } from './native-loader.js';

const fileLocks = new Map();

const getFileLock = (path) => {
    let mutex = fileLocks.get(path);
    if (!mutex) {
        mutex = new Mutex();
        fileLocks.set(path, mutex);
    }
    return mutex;
};

const toBuffer = (val) => {
    if (!val) return val;
    if (Buffer.isBuffer(val)) return val;
    if (val instanceof Uint8Array) return Buffer.from(val);
    if (typeof val === 'string') return Buffer.from(val, 'base64');
    if (val?.data) return Buffer.from(val.data, typeof val.data === 'string' ? 'base64' : undefined);
    return Buffer.from(val);
};

export const useMultiFileAuthState = async (folder) => {
    const fixFileName = (file) => {
        if (nativeRust?.authFixFileName) {
            try {
                return nativeRust.authFixFileName(file || '');
            } catch {
            }
        }
        return file?.replace(new RegExp('/', 'g'), '__')?.replace(new RegExp('\\\\', 'g'), '__')?.replace(new RegExp(':', 'g'), '-');
    };

    const writeData = async (data, file) => {
        const filePath = join(folder, fixFileName(file));
        const mutex = getFileLock(filePath);
        return mutex.acquire().then(async (release) => {
            try {
                await writeFile(filePath, JSON.stringify(data, BufferJSON.replacer));
            } finally {
                release();
            }
        });
    };

    const readData = async (file) => {
        try {
            const filePath = join(folder, fixFileName(file));
            const mutex = getFileLock(filePath);
            return await mutex.acquire().then(async (release) => {
                try {
                    const data = await readFile(filePath, { encoding: 'utf-8' });
                    return JSON.parse(data, BufferJSON.reviver);
                } finally {
                    release();
                }
            });
        } catch {
            return null;
        }
    };

    const removeData = async (file) => {
        try {
            const filePath = join(folder, fixFileName(file));
            const mutex = getFileLock(filePath);
            return mutex.acquire().then(async (release) => {
                try {
                    await unlink(filePath);
                } catch {
                } finally {
                    release();
                }
            });
        } catch {
        }
    };

    const folderInfo = await stat(folder).catch(() => { });
    if (folderInfo) {
        if (!folderInfo.isDirectory()) {
            throw new Error(`found something that is not a directory at ${folder}, either delete it or specify a different location`);
        }
    } else {
        await mkdir(folder, { recursive: true });
    }

    const rawCreds = await readData('creds.json');
    let creds;
    if (rawCreds) {
        creds = rawCreds;

        if (nativeRust?.authNormalizeCreds) {
            try {
                const normJson = nativeRust.authNormalizeCreds(JSON.stringify(rawCreds, BufferJSON.replacer));
                const parsed = JSON.parse(normJson, BufferJSON.reviver);
                Object.assign(creds, parsed);
            } catch {
            }
        }

        const rawNoise = creds.noiseKey || creds.noise_key;
        if (rawNoise) {
            creds.noiseKey = {
                private: toBuffer(rawNoise.private),
                public: toBuffer(rawNoise.public)
            };
        }

        const rawPairing = creds.pairingEphemeralKeyPair || creds.pairing_ephemeral_key_pair;
        if (rawPairing) {
            creds.pairingEphemeralKeyPair = {
                private: toBuffer(rawPairing.private),
                public: toBuffer(rawPairing.public)
            };
        }

        const rawIdentity = creds.signedIdentityKey || creds.signed_identity_key;
        if (rawIdentity) {
            creds.signedIdentityKey = {
                private: toBuffer(rawIdentity.private),
                public: toBuffer(rawIdentity.public)
            };
        }

        const rawSpk = creds.signedPreKey || creds.signed_pre_key;
        if (rawSpk) {
            const innerKp = rawSpk.keyPair || rawSpk.key_pair;
            creds.signedPreKey = {
                keyPair: {
                    private: toBuffer(innerKp?.private),
                    public: toBuffer(innerKp?.public)
                },
                signature: toBuffer(rawSpk.signature),
                keyId: rawSpk.keyId ?? rawSpk.key_id
            };
        }

        if (creds.registration_id !== undefined && creds.registrationId === undefined) {
            creds.registrationId = creds.registration_id;
        }
        if (creds.adv_secret_key !== undefined && creds.advSecretKey === undefined) {
            creds.advSecretKey = creds.adv_secret_key;
        }
        if (creds.next_pre_key_id !== undefined && creds.nextPreKeyId === undefined) {
            creds.nextPreKeyId = creds.next_pre_key_id;
        }
        if (creds.first_unuploaded_pre_key_id !== undefined && creds.firstUnuploadedPreKeyId === undefined) {
            creds.firstUnuploadedPreKeyId = creds.first_unuploaded_pre_key_id;
        }
        if (creds.account_sync_counter !== undefined && creds.accountSyncCounter === undefined) {
            creds.accountSyncCounter = creds.account_sync_counter;
        }
        if (creds.pairing_code !== undefined && creds.pairingCode === undefined) {
            creds.pairingCode = creds.pairing_code;
        }
    } else {
        creds = initAuthCreds();
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    if (nativeRust?.authReadKeysBatch) {
                        try {
                            const raw = nativeRust.authReadKeysBatch(folder, type, ids);
                            const batchMap = JSON.parse(raw);
                            for (const id of ids) {
                                const fileContent = batchMap[id];
                                if (fileContent) {
                                    try {
                                        let value = JSON.parse(fileContent, BufferJSON.reviver);
                                        if (type === 'app-state-sync-key' && value) {
                                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                        }
                                        data[id] = value;
                                    } catch {
                                        data[id] = null;
                                    }
                                } else {
                                    data[id] = null;
                                }
                            }
                            return data;
                        } catch {
                        }
                    }

                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}.json`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    if (nativeRust?.authWriteKeysBatch) {
                        try {
                            const ops = {};
                            for (const category in data) {
                                ops[category] = {};
                                for (const id in data[category]) {
                                    const value = data[category][id];
                                    ops[category][id] = value ? JSON.stringify(value, BufferJSON.replacer) : null;
                                }
                            }
                            nativeRust.authWriteKeysBatch(folder, JSON.stringify(ops));
                            return;
                        } catch {
                        }
                    }

                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            tasks.push(value ? writeData(value, file) : removeData(file));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            return writeData(creds, 'creds.json');
        }
    };
};