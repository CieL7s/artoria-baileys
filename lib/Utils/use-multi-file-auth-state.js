import { Mutex } from 'async-mutex';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { proto } from '../../WAProto/index.js';
import { initAuthCreds } from './auth-utils.js';
import { BufferJSON } from './generics.js';
// We need to lock files due to the fact that we are using async functions to read and write files
// https://github.com/WhiskeySockets/Baileys/issues/794
// https://github.com/nodejs/node/issues/26338
// Use a Map to store mutexes for each file path
const fileLocks = new Map();
// Get or create a mutex for a specific file path
const getFileLock = (path) => {
    let mutex = fileLocks.get(path);
    if (!mutex) {
        mutex = new Mutex();
        fileLocks.set(path, mutex);
    }
    return mutex;
};
/**
 * stores the full authentication state in a single folder.
 * Far more efficient than singlefileauthstate
 *
 * Again, I wouldn't endorse this for any production level use other than perhaps a bot.
 * Would recommend writing an auth state for use with a proper SQL or No-SQL DB
 * */
export const useMultiFileAuthState = async (folder) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeData = async (data, file) => {
        const filePath = join(folder, fixFileName(file));
        const mutex = getFileLock(filePath);
        return mutex.acquire().then(async (release) => {
            try {
                await writeFile(filePath, JSON.stringify(data, BufferJSON.replacer));
            }
            finally {
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
                }
                finally {
                    release();
                }
            });
        }
        catch (error) {
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
                }
                catch {
                }
                finally {
                    release();
                }
            });
        }
        catch { }
    };
    const folderInfo = await stat(folder).catch(() => { });
    if (folderInfo) {
        if (!folderInfo.isDirectory()) {
            throw new Error(`found something that is not a directory at ${folder}, either delete it or specify a different location`);
        }
    }
    else {
        await mkdir(folder, { recursive: true });
    }
    const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');
    const rawCreds = await readData('creds.json');
    let creds;
    if (rawCreds) {
        creds = rawCreds;
        if (!creds.noiseKey && creds.noise_key) {
            creds.noiseKey = {
                private: Buffer.from(creds.noise_key.private?.data || creds.noise_key.private, typeof (creds.noise_key.private?.data || creds.noise_key.private) === 'string' ? 'base64' : undefined),
                public: Buffer.from(creds.noise_key.public?.data || creds.noise_key.public, typeof (creds.noise_key.public?.data || creds.noise_key.public) === 'string' ? 'base64' : undefined)
            };
        }
        if (!creds.pairingEphemeralKeyPair && creds.pairing_ephemeral_key_pair) {
            creds.pairingEphemeralKeyPair = {
                private: Buffer.from(creds.pairing_ephemeral_key_pair.private?.data || creds.pairing_ephemeral_key_pair.private, typeof (creds.pairing_ephemeral_key_pair.private?.data || creds.pairing_ephemeral_key_pair.private) === 'string' ? 'base64' : undefined),
                public: Buffer.from(creds.pairing_ephemeral_key_pair.public?.data || creds.pairing_ephemeral_key_pair.public, typeof (creds.pairing_ephemeral_key_pair.public?.data || creds.pairing_ephemeral_key_pair.public) === 'string' ? 'base64' : undefined)
            };
        }
        if (!creds.signedIdentityKey && creds.signed_identity_key) {
            creds.signedIdentityKey = {
                private: Buffer.from(creds.signed_identity_key.private?.data || creds.signed_identity_key.private, typeof (creds.signed_identity_key.private?.data || creds.signed_identity_key.private) === 'string' ? 'base64' : undefined),
                public: Buffer.from(creds.signed_identity_key.public?.data || creds.signed_identity_key.public, typeof (creds.signed_identity_key.public?.data || creds.signed_identity_key.public) === 'string' ? 'base64' : undefined)
            };
        }
        if (!creds.signedPreKey && creds.signed_pre_key) {
            creds.signedPreKey = {
                keyPair: {
                    private: Buffer.from(creds.signed_pre_key.key_pair?.private?.data || creds.signed_pre_key.key_pair?.private, typeof (creds.signed_pre_key.key_pair?.private?.data || creds.signed_pre_key.key_pair?.private) === 'string' ? 'base64' : undefined),
                    public: Buffer.from(creds.signed_pre_key.key_pair?.public?.data || creds.signed_pre_key.key_pair?.public, typeof (creds.signed_pre_key.key_pair?.public?.data || creds.signed_pre_key.key_pair?.public) === 'string' ? 'base64' : undefined)
                },
                signature: Buffer.from(creds.signed_pre_key.signature?.data || creds.signed_pre_key.signature, typeof (creds.signed_pre_key.signature?.data || creds.signed_pre_key.signature) === 'string' ? 'base64' : undefined),
                keyId: creds.signed_pre_key.key_id
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
    } else {
        creds = initAuthCreds();
    }
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
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
//# sourceMappingURL=use-multi-file-auth-state.js.map