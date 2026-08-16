import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import * as libsignal from 'libsignal';
// @ts-ignore
import protoPkg from 'libsignal/src/protobufs.js';
const PreKeyWhisperMessage = protoPkg?.default?.PreKeyWhisperMessage || protoPkg?.PreKeyWhisperMessage || protoPkg;
import { LRUCache } from 'lru-cache';
import { generateSignalPubKey } from '../Utils/index.js';
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser, jidDecode, transferDevice, WAJIDDomains } from '../WABinary/index.js';
import { SenderKeyName } from './Group/sender-key-name.js';
import { SenderKeyRecord } from './Group/sender-key-record.js';
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage } from './Group/index.js';
import { LIDMappingStore } from './lid-mapping.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let rust;
try {
    rust = require(path.join(__dirname, '../../baileys-napi.node'));
} catch (e) {
    console.warn('[Artoria Signal] Warning: Failed to load native Rust engine, falling back to JS libsignal:', e.message);
}
/** Extract identity key from PreKeyWhisperMessage for identity change detection */
function extractIdentityFromPkmsg(ciphertext) {
    try {
        if (!ciphertext || ciphertext.length < 2) {
            return undefined;
        }
        // Version byte check (version 3)
        const version = ciphertext[0];
        if ((version & 0xf) !== 3) {
            return undefined;
        }
        // Parse protobuf (skip version byte)
        const preKeyProto = PreKeyWhisperMessage.decode(ciphertext.slice(1));
        if (preKeyProto.identityKey?.length === 33) {
            return new Uint8Array(preKeyProto.identityKey);
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export function makeLibSignalRepository(auth, logger, pnToLIDFunc) {
    const lidMapping = new LIDMappingStore(auth.keys, logger, pnToLIDFunc);
    const storage = signalStorage(auth, lidMapping);
    const parsedKeys = auth.keys;
    const migratedSessionCache = new LRUCache({
        ttl: 3 * 24 * 60 * 60 * 1000, // 7 days
        ttlAutopurge: true,
        updateAgeOnGet: true
    });
    const ensureSenderKeyAndCreateSkdm = async (group, meId) => {
        const senderName = jidToSignalSenderKeyName(group, meId);
        const senderNameStr = senderName.toString();
        const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
        if (!senderKey) {
            await storage.storeSenderKey(senderName, new SenderKeyRecord());
        }
        const skdm = await new GroupSessionBuilder(storage).create(senderName);
        return { senderName, skdm };
    };
    const repository = {
        decryptGroupMessage({ group, authorJid, msg }) {
            const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
            const senderName = jidToSignalSenderKeyName(group, authorJid);
            const cipher = new GroupCipher(storage, senderName);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                return cipher.decrypt(buf);
            }, group);
        },
        async processSenderKeyDistributionMessage({ item, authorJid }) {
            const builder = new GroupSessionBuilder(storage);
            if (!item.groupId) {
                throw new Error('Group ID is required for sender key distribution message');
            }
            const senderName = jidToSignalSenderKeyName(item.groupId, authorJid);
            const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage);
            const senderNameStr = senderName.toString();
            const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
            if (!senderKey) {
                await storage.storeSenderKey(senderName, new SenderKeyRecord());
            }
            return parsedKeys.transaction(async () => {
                const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
                if (!senderKey) {
                    await storage.storeSenderKey(senderName, new SenderKeyRecord());
                }
                const recordBefore = await storage.loadSenderKey(senderName);
                await builder.process(senderName, senderMsg);
                try {
                    const recordAfter = await storage.loadSenderKey(senderName);
                    const { recordLevel2Skdm } = await import('../../test/tools/traffic-recorder-level2.js');
                    recordLevel2Skdm({
                        groupId: item.groupId,
                        authorJid,
                        inputBytes: item.axolotlSenderKeyDistributionMessage,
                        recordBefore: recordBefore ? (typeof recordBefore.serialize === 'function' ? recordBefore.serialize() : recordBefore) : null,
                        recordAfter: recordAfter ? (typeof recordAfter.serialize === 'function' ? recordAfter.serialize() : recordAfter) : null
                    });
                } catch {}
            }, item.groupId);
        },
        async decryptMessage({ jid, type, ciphertext }) {
            const buf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
            const addr = jidToSignalProtocolAddress(jid);
            const session = new libsignal.SessionCipher(storage, addr);
            const addrStr = addr.toString();
            const sessionBefore = await storage.loadSession(addrStr);
            let identityKey = null;
            if (type === 'pkmsg') {
                identityKey = extractIdentityFromPkmsg(buf);
                if (identityKey) {
                    const identityChanged = await storage.saveIdentity(addrStr, identityKey);
                    if (identityChanged) {
                        logger.info({ jid, addr: addrStr }, 'identity key changed or new contact, session will be re-established');
                    }
                }
            }
            async function doDecrypt() {
                let result;
                const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
                if (useRust) {
                    try {
                        const ourIdentity = await storage.getOurIdentity();
                        let record = await storage.loadSession(addrStr);
                        if (!record) {
                            record = new libsignal.SessionRecord();
                        }
                        const recordJson = JSON.stringify(record.serialize());
                        if (type === 'pkmsg') {
                            const preKeyProto = PreKeyWhisperMessage.decode(buf.slice(1));
                            const preKeyPair = preKeyProto.preKeyId ? await storage.loadPreKey(preKeyProto.preKeyId) : null;
                            const signedPreKeyPair = await storage.loadSignedPreKey(preKeyProto.signedPreKeyId);
                            if (!signedPreKeyPair) {
                                throw new Error('Missing SignedPreKey');
                            }
                            const res = rust.signalSessionBuilderProcessIncomingPkmsg(
                                recordJson,
                                ourIdentity.privKey,
                                ourIdentity.pubKey,
                                signedPreKeyPair.privKey,
                                signedPreKeyPair.pubKey,
                                preKeyPair ? preKeyPair.privKey : null,
                                buf
                            );
                            result = res.plaintext;
                            const updatedRecord = libsignal.SessionRecord.deserialize(JSON.parse(res.recordJson));
                            await storage.storeSession(addrStr, updatedRecord);
                            if (res.preKeyId != null) {
                                await storage.removePreKey(res.preKeyId);
                            }
                        } else if (type === 'msg') {
                            const res = rust.signalSessionCipherDecryptWhisperMessage(
                                recordJson,
                                ourIdentity.pubKey,
                                buf
                            );
                            result = res.plaintext;
                            const updatedRecord = libsignal.SessionRecord.deserialize(JSON.parse(res.recordJson));
                            await storage.storeSession(addrStr, updatedRecord);
                        }
                    } catch (rustErr) {
                        console.warn(`[Artoria Signal] Rust session decrypt error for ${addrStr} (${type}): ${rustErr.message}. Explicitly falling back to JS libsignal.`);
                        switch (type) {
                            case 'pkmsg':
                                result = await session.decryptPreKeyWhisperMessage(buf);
                                break;
                            case 'msg':
                                result = await session.decryptWhisperMessage(buf);
                                break;
                        }
                    }
                } else {
                    switch (type) {
                        case 'pkmsg':
                            result = await session.decryptPreKeyWhisperMessage(buf);
                            break;
                        case 'msg':
                            result = await session.decryptWhisperMessage(buf);
                            break;
                    }
                }
                const sessionAfter = await storage.loadSession(addrStr);
                try {
                    const { recordLevel2Pairwise } = await import('../../test/tools/traffic-recorder-level2.js');
                    recordLevel2Pairwise({
                        jid,
                        type,
                        inputBytes: buf,
                        plaintext: result,
                        sessionBefore: sessionBefore ? (typeof sessionBefore.serialize === 'function' ? sessionBefore.serialize() : sessionBefore) : null,
                        sessionAfter: sessionAfter ? (typeof sessionAfter.serialize === 'function' ? sessionAfter.serialize() : sessionAfter) : null,
                        identityKey
                    });
                } catch {}
                return result;
            }
            // If it's not a sync message, we need to ensure atomicity
            // For regular messages, we use a transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                return await doDecrypt();
            }, jid);
        },
        async encryptMessage({ jid, data }) {
            const addr = jidToSignalProtocolAddress(jid);
            const addrStr = addr.toString();
            const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust;
            const cipher = new libsignal.SessionCipher(storage, addr);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                if (useRust) {
                    try {
                        const record = await storage.loadSession(addrStr);
const openSession = record?.getOpenSession();
                        if (openSession && !openSession.pendingPreKey) {
                            const ourIdentity = await storage.getOurIdentity();
                            const recordJson = JSON.stringify(record.serialize());
                            const encRes = rust.signalSessionCipherEncrypt(
                                recordJson,
                                ourIdentity.pubKey,
                                Buffer.isBuffer(data) ? data : Buffer.from(data)
                            );
                            const updatedRecord = libsignal.SessionRecord.deserialize(JSON.parse(encRes.recordJson));
                            await storage.storeSession(addrStr, updatedRecord);
                            return { type: 'msg', ciphertext: encRes.ciphertext };
                        }
                    } catch (rustEncErr) {
                        console.warn(`[Artoria Signal] Rust session encrypt error for ${addrStr}: ${rustEncErr.message}. Explicitly falling back to JS libsignal.`);
                    }
                }
                const { type: sigType, body } = await cipher.encrypt(data);
                const type = sigType === 3 ? 'pkmsg' : 'msg';
                return { type, ciphertext: Buffer.from(body, 'binary') };
            }, jid);
        },
        async encryptGroupMessage({ group, meId, data }) {
            return parsedKeys.transaction(async () => {
                const { senderName, skdm } = await ensureSenderKeyAndCreateSkdm(group, meId);
                const ciphertext = await new GroupCipher(storage, senderName).encrypt(data);
                return { ciphertext, senderKeyDistributionMessage: skdm.serialize() };
            }, group);
        },
        async getSenderKeyDistributionMessage({ group, meId }) {
            return parsedKeys.transaction(async () => {
                const { skdm } = await ensureSenderKeyAndCreateSkdm(group, meId);
                return skdm.serialize();
            }, group);
        },
        async hasSenderKey({ group, meId }) {
            const senderName = jidToSignalSenderKeyName(group, meId).toString();
            const { [senderName]: key } = await auth.keys.get('sender-key', [senderName]);
            return !!key;
        },
        async getSessionInfo(jid) {
            const addr = jidToSignalProtocolAddress(jid).toString();
            const session = (await storage.loadSession(addr));
            if (!session) {
                return null;
            }
            const open = session.getOpenSession?.();
            const baseKey = open?.indexInfo?.baseKey;
            const registrationId = open?.registrationId;
            if (!baseKey || typeof registrationId !== 'number') {
                return null;
            }
            return { baseKey: new Uint8Array(baseKey), registrationId };
        },
        async injectE2ESession({ jid, session }) {
            const addrStr = jidToSignalProtocolAddress(jid).toString();
            console.log('[SIGNAL_INJECT_E2E_SESSION]', { jid, addrStr });
            logger.trace({ jid }, 'injecting E2EE session');
            const cipher = new libsignal.SessionBuilder(storage, jidToSignalProtocolAddress(jid));
            return parsedKeys.transaction(async () => {
                // libsignal runtime accepts an absent prekey (initOutgoing checks `device.preKey && ...`)
                // but the bundled .d.ts marks it required.
                await cipher.initOutgoing(session);
            }, jid);
        },
        jidToSignalProtocolAddress(jid) {
            return jidToSignalProtocolAddress(jid).toString();
        },
        // Optimized direct access to LID mapping store
        lidMapping,
        async validateSession(jid) {
            try {
                const addr = jidToSignalProtocolAddress(jid);
                const session = await storage.loadSession(addr.toString());
                if (!session) {
                    return { exists: false, reason: 'no session' };
                }
                if (!session.haveOpenSession()) {
                    return { exists: false, reason: 'no open session' };
                }
                return { exists: true };
            }
            catch (error) {
                return { exists: false, reason: 'validation error' };
            }
        },
        async deleteSession(jids) {
            if (!jids.length)
                return;
            // Convert JIDs to signal addresses and prepare for bulk deletion
            const sessionUpdates = {};
            jids.forEach(jid => {
                const addr = jidToSignalProtocolAddress(jid);
                sessionUpdates[addr.toString()] = null;
            });
            // Single transaction for all deletions
            return parsedKeys.transaction(async () => {
                await auth.keys.set({ session: sessionUpdates });
            }, `delete-${jids.length}-sessions`);
        },
        close() {
            migratedSessionCache.clear();
            lidMapping.close();
        },
        async migrateSession(fromJid, toJid) {
            // TODO: use usync to handle this entire mess
            if (!fromJid || (!isLidUser(toJid) && !isHostedLidUser(toJid)))
                return { migrated: 0, skipped: 0, total: 0 };
            // Only support PN to LID migration
            if (!isPnUser(fromJid) && !isHostedPnUser(fromJid)) {
                return { migrated: 0, skipped: 0, total: 1 };
            }
            const { user } = jidDecode(fromJid);
            logger.debug({ fromJid }, 'bulk device migration - loading all user devices');
            // Get user's device list from storage
            const { [user]: userDevices } = await parsedKeys.get('device-list', [user]);
            if (!userDevices) {
                return { migrated: 0, skipped: 0, total: 0 };
            }
            const { device: fromDevice } = jidDecode(fromJid);
            const fromDeviceStr = fromDevice?.toString() || '0';
            if (!userDevices.includes(fromDeviceStr)) {
                userDevices.push(fromDeviceStr);
            }
            // Filter out cached devices before database fetch
            const uncachedDevices = userDevices.filter(device => {
                const deviceKey = `${user}.${device}`;
                return !migratedSessionCache.has(deviceKey);
            });
            // Bulk check session existence only for uncached devices
            const deviceSessionKeys = uncachedDevices.map(device => `${user}.${device}`);
            const existingSessions = await parsedKeys.get('session', deviceSessionKeys);
            // Step 3: Convert existing sessions to JIDs (only migrate sessions that exist)
            const deviceJids = [];
            for (const [sessionKey, sessionData] of Object.entries(existingSessions)) {
                if (sessionData) {
                    // Session exists in storage
                    const deviceStr = sessionKey.split('.')[1];
                    if (!deviceStr)
                        continue;
                    const deviceNum = parseInt(deviceStr);
                    let jid = deviceNum === 0 ? `${user}@s.whatsapp.net` : `${user}:${deviceNum}@s.whatsapp.net`;
                    if (deviceNum === 99) {
                        jid = `${user}:99@hosted`;
                    }
                    deviceJids.push(jid);
                }
            }
            logger.debug({
                fromJid,
                totalDevices: userDevices.length,
                devicesWithSessions: deviceJids.length,
                devices: deviceJids
            }, 'bulk device migration complete - all user devices processed');
            // Single transaction for all migrations
            return parsedKeys.transaction(async () => {
                const migrationOps = deviceJids.map(jid => {
                    const lidWithDevice = transferDevice(jid, toJid);
                    const fromDecoded = jidDecode(jid);
                    const toDecoded = jidDecode(lidWithDevice);
                    return {
                        fromJid: jid,
                        toJid: lidWithDevice,
                        pnUser: fromDecoded.user,
                        lidUser: toDecoded.user,
                        deviceId: fromDecoded.device || 0,
                        fromAddr: jidToSignalProtocolAddress(jid),
                        toAddr: jidToSignalProtocolAddress(lidWithDevice)
                    };
                });
                const totalOps = migrationOps.length;
                let migratedCount = 0;
                // Bulk fetch PN sessions - already exist (verified during device discovery)
                const pnAddrStrings = Array.from(new Set(migrationOps.map(op => op.fromAddr.toString())));
                const pnSessions = await parsedKeys.get('session', pnAddrStrings);
                // Prepare bulk session updates (PN → LID migration + deletion)
                const sessionUpdates = {};
                for (const op of migrationOps) {
                    const pnAddrStr = op.fromAddr.toString();
                    const lidAddrStr = op.toAddr.toString();
                    const pnSession = pnSessions[pnAddrStr];
                    if (pnSession) {
                        // Session exists (guaranteed from device discovery)
                        const fromSession = libsignal.SessionRecord.deserialize(pnSession);
                        if (fromSession.haveOpenSession()) {
                            // Queue for bulk update: copy to LID, delete from PN
                            sessionUpdates[lidAddrStr] = fromSession.serialize();
                            sessionUpdates[pnAddrStr] = null;
                            migratedCount++;
                        }
                    }
                }
                // Single bulk session update for all migrations
                if (Object.keys(sessionUpdates).length > 0) {
                    await parsedKeys.set({ session: sessionUpdates });
                    logger.debug({ migratedSessions: migratedCount }, 'bulk session migration complete');
                    // Cache device-level migrations
                    for (const op of migrationOps) {
                        if (sessionUpdates[op.toAddr.toString()]) {
                            const deviceKey = `${op.pnUser}.${op.deviceId}`;
                            migratedSessionCache.set(deviceKey, true);
                        }
                    }
                }
                const skippedCount = totalOps - migratedCount;
                return { migrated: migratedCount, skipped: skippedCount, total: totalOps };
            }, `migrate-${deviceJids.length}-sessions-${jidDecode(toJid)?.user}`);
        }
    };
    return repository;
}
const jidToSignalProtocolAddress = (jid) => {
    const decoded = jidDecode(jid);
    const { user, device, server, domainType } = decoded;
    if (!user) {
        throw new Error(`JID decoded but user is empty: "${jid}" -> user: "${user}", server: "${server}", device: ${device}`);
    }
    const signalUser = domainType !== WAJIDDomains.WHATSAPP ? `${user}_${domainType}` : user;
    const finalDevice = device || 0;
    if (device === 99 && decoded.server !== 'hosted' && decoded.server !== 'hosted.lid') {
        throw new Error('Unexpected non-hosted device JID with device 99. This ID seems invalid. ID:' + jid);
    }
    return new libsignal.ProtocolAddress(signalUser, finalDevice);
};
const jidToSignalSenderKeyName = (group, user) => {
    return new SenderKeyName(group, jidToSignalProtocolAddress(user));
};
function signalStorage({ creds, keys }, lidMapping) {
    const preKeyCache = new LRUCache({ max: 500, ttl: 10 * 60 * 1000 });
    // Shared function to resolve PN signal address to LID if mapping exists
    const resolveLIDSignalAddress = async (id) => {
        if (id.includes('.')) {
            const [deviceId, device] = id.split('.');
            const [user, domainType_] = deviceId.split('_');
            const domainType = parseInt(domainType_ || '0');
            if (domainType === WAJIDDomains.LID || domainType === WAJIDDomains.HOSTED_LID)
                return id;
            const pnJid = `${user}${device !== '0' ? `:${device}` : ''}@${domainType === WAJIDDomains.HOSTED ? 'hosted' : 's.whatsapp.net'}`;
            const lidForPN = await lidMapping.getLIDForPN(pnJid);
            if (lidForPN) {
                const lidAddr = jidToSignalProtocolAddress(lidForPN);
                return lidAddr.toString();
            }
        }
        return id;
    };
    return {
        loadSession: async (id) => {
            try {
                const wireJid = await resolveLIDSignalAddress(id);
                const { [wireJid]: sess } = await keys.get('session', [wireJid]);
                if (sess) {
                    let parsed = sess;
                    if (Buffer.isBuffer(parsed)) {
                        parsed = JSON.parse(parsed.toString('utf-8'));
                    } else if (typeof parsed === 'string') {
                        try { parsed = JSON.parse(parsed); } catch {}
                    } else if (parsed?.type === 'Buffer' && Array.isArray(parsed.data)) {
                        parsed = JSON.parse(Buffer.from(parsed.data).toString('utf-8'));
                    }
                    return libsignal.SessionRecord.deserialize(parsed);
                }
            }
            catch (e) {
                console.error('[SIGNAL_LOAD_SESSION_ERROR]', { id, error: e?.message });
                return null;
            }
            return null;
        },
        storeSession: async (id, session) => {
            const wireJid = await resolveLIDSignalAddress(id);
            console.log('[SIGNAL_STORE_SESSION]', { id, wireJid });
            await keys.set({ session: { [wireJid]: session.serialize() } });
        },
        isTrustedIdentity: () => {
            return true; // TOFU - Trust on First Use (same as WhatsApp Web)
        },
        loadIdentityKey: async (id) => {
            const wireJid = await resolveLIDSignalAddress(id);
            const { [wireJid]: key } = await keys.get('identity-key', [wireJid]);
            if (!key) return undefined;
            const toBuf = (k) => {
                if (!k) return undefined;
                if (Buffer.isBuffer(k)) return k;
                if (Array.isArray(k)) return Buffer.from(k);
                if (typeof k === 'string') return Buffer.from(k, 'base64');
                if (k.type === 'Buffer' && typeof k.data === 'string') return Buffer.from(k.data, 'base64');
                if (k.type === 'Buffer' && Array.isArray(k.data)) return Buffer.from(k.data);
                if (k.data) return toBuf(k.data);
                return Buffer.from(k);
            };
            return toBuf(key);
        },
        saveIdentity: async (id, identityKey) => {
            const wireJid = await resolveLIDSignalAddress(id);
            const { [wireJid]: existingKey } = await keys.get('identity-key', [wireJid]);
            const keysMatch = existingKey?.length === identityKey.length && existingKey.every((byte, i) => byte === identityKey[i]);
            if (existingKey && !keysMatch) {
                // Identity changed - clear session and update key
                await keys.set({
                    session: { [wireJid]: null },
                    'identity-key': { [wireJid]: identityKey }
                });
                return true;
            }
            if (!existingKey) {
                // New contact - Trust on First Use (TOFU)
                await keys.set({ 'identity-key': { [wireJid]: identityKey } });
                return true;
            }
            return false;
        },
        loadPreKey: async (id) => {
            const keyId = id.toString();
            let key = preKeyCache.get(keyId);
            if (!key) {
                const { [keyId]: fetchedKey } = await keys.get('pre-key', [keyId]);
                key = fetchedKey;
                if (key) {
                    preKeyCache.set(keyId, key);
                }
            }
            if (key) {
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
                return {
                    privKey: toBuf(key.private),
                    pubKey: toBuf(key.public)
                };
            }
        },
        removePreKey: async (id) => {
            const keyId = id.toString();
            if (!preKeyCache.has(keyId)) {
                try {
                    const { [keyId]: fetchedKey } = await keys.get('pre-key', [keyId]);
                    if (fetchedKey) {
                        preKeyCache.set(keyId, fetchedKey);
                    }
                } catch {}
            }
            return keys.set({ 'pre-key': { [keyId]: null } });
        },
        loadSignedPreKey: () => {
            const key = creds.signedPreKey || creds.signed_pre_key;
            if (!key) return undefined;
            const kp = key.keyPair || key.key_pair || key;
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
            return {
                privKey: toBuf(kp.private),
                pubKey: toBuf(kp.public)
            };
        },
        loadSenderKey: async (senderKeyName) => {
            const keyId = senderKeyName.toString();
            const { [keyId]: key } = await keys.get('sender-key', [keyId]);
            if (key) {
                return SenderKeyRecord.deserialize(key);
            }
            return new SenderKeyRecord();
        },
        storeSenderKey: async (senderKeyName, key) => {
            const keyId = senderKeyName.toString();
            const serialized = JSON.stringify(key.serialize());
            await keys.set({ 'sender-key': { [keyId]: Buffer.from(serialized, 'utf-8') } });
        },
        getOurRegistrationId: () => creds.registrationId || creds.registration_id,
        getOurIdentity: () => {
            const signedIdentityKey = creds.signedIdentityKey || creds.signed_identity_key;
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
            const pubKey = toBuf(signedIdentityKey?.public);
            return {
                privKey: toBuf(signedIdentityKey?.private),
                pubKey: Buffer.from(generateSignalPubKey(pubKey))
            };
        }
    };
}
//# sourceMappingURL=libsignal.js.map