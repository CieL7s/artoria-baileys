import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { PreKeyManager } from '../lib/Utils/pre-key-manager.js';
import { MessageRetryManager, RetryReason } from '../lib/Utils/message-retry-manager.js';
import { handleIdentityChange } from '../lib/Utils/identity-change-handler.js';
import { useMultiFileAuthState } from '../lib/Utils/use-multi-file-auth-state.js';
import { nativeRust as rust } from '../lib/Utils/native-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('================================================================');
console.log('       AURIEL-BAILEYS LEVEL 4 RUST PARITY TEST SUITE            ');
console.log('================================================================\n');

let passCount = 0;
function test(name, fn) {
    try {
        fn();
        passCount++;
        console.log(`  ✅ [PASS #${passCount}] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
        throw err;
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        passCount++;
        console.log(`  ✅ [PASS #${passCount}] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
        throw err;
    }
}

test('Level 4 Native Rust Bindings Availability', () => {
    assert.strictEqual(typeof rust.preKeyGenerateBatch, 'function');
    assert.strictEqual(typeof rust.preKeyProcessOperations, 'function');
    assert.strictEqual(typeof rust.preKeyFilterInvalidDeletions, 'function');
    assert.strictEqual(typeof rust.retryManagerIsMacError, 'function');
    assert.strictEqual(typeof rust.retryManagerParseErrorCode, 'function');
    assert.strictEqual(typeof rust.retryManagerShouldRecreateSession, 'function');
    assert.strictEqual(typeof rust.retryManagerHasSameBaseKey, 'function');
    assert.strictEqual(typeof rust.identityHandlerEvaluate, 'function');
    assert.strictEqual(typeof rust.authFixFileName, 'function');
    assert.strictEqual(typeof rust.authReadKeysBatch, 'function');
    assert.strictEqual(typeof rust.authWriteKeysBatch, 'function');
    assert.strictEqual(typeof rust.authNormalizeCreds, 'function');
});

test('PreKeyManager: Batch Key Generation Range & Buffer Parity', () => {
    const keys = PreKeyManager.generateBatch(100, 5);
    assert.strictEqual(keys.length, 5);
    assert.strictEqual(keys[0].keyId, 100);
    assert.strictEqual(keys[4].keyId, 104);
    assert.strictEqual(Buffer.isBuffer(keys[0].keyPair.public), true);
    assert.strictEqual(Buffer.isBuffer(keys[0].keyPair.private), true);
    assert.strictEqual(keys[0].keyPair.public.length, 32);
    assert.strictEqual(keys[0].keyPair.private.length, 32);
});

await testAsync('PreKeyManager: In-Transaction Operations & Tombstone Isolation', async () => {
    const mockStore = { get: async () => ({}) };
    const warnings = [];
    const logger = { warn: (msg) => warnings.push(msg) };
    const mgr = new PreKeyManager(mockStore, logger);

    const txCache = {
        'pre-key': {
            '1': { public: Buffer.from([1]) },
            '2': null
        }
    };
    const mutations = {};
    const opData = {
        'pre-key': {
            '1': null,
            '2': null,
            '3': null,
            '4': { public: Buffer.from([4]) }
        }
    };

    await mgr.processOperations(opData, 'pre-key', txCache, mutations, true);

    assert.strictEqual(txCache['pre-key']['1'], null);
    assert.strictEqual(mutations['pre-key']['1'], null);
    assert.strictEqual(txCache['pre-key']['2'], null);
    assert.strictEqual(mutations['pre-key']['2'], undefined);
    assert.strictEqual(txCache['pre-key']['3'], undefined);
    assert.strictEqual(mutations['pre-key']['3'], undefined);
    assert.deepStrictEqual(txCache['pre-key']['4'], { public: Buffer.from([4]) });
    assert.strictEqual(warnings.length, 2);
    assert.ok(warnings[0].includes('Skipping deletion of non-existent pre-key in transaction: 2'));
    assert.ok(warnings[1].includes('Skipping deletion of non-existent pre-key in transaction: 3'));
});

await testAsync('PreKeyManager: Direct Deletions Validation Against Store', async () => {
    const mockStore = {
        get: async (type, ids) => ({
            '10': { val: 10 },
            '20': null
        })
    };
    const warnings = [];
    const logger = { warn: (msg) => warnings.push(msg) };
    const mgr = new PreKeyManager(mockStore, logger);

    const deleteData = {
        'pre-key': {
            '10': null,
            '20': null,
            '30': null
        }
    };

    await mgr.validateDeletions(deleteData, 'pre-key');

    assert.strictEqual(deleteData['pre-key']['10'], null);
    assert.strictEqual(deleteData['pre-key']['20'], undefined);
    assert.strictEqual(deleteData['pre-key']['30'], undefined);
    assert.strictEqual(warnings.length, 2);
});

test('MessageRetryManager: MAC Error Codes & Code Parsing', () => {
    const logger = { debug: () => {}, warn: () => {} };
    const mgr = new MessageRetryManager(logger, 3);

    assert.strictEqual(mgr.isMacError(RetryReason.SignalErrorInvalidMessage), true);
    assert.strictEqual(mgr.isMacError(RetryReason.SignalErrorBadMac), true);
    assert.strictEqual(mgr.isMacError(RetryReason.SignalErrorNoSession), false);
    assert.strictEqual(mgr.isMacError(RetryReason.UnknownError), false);
    assert.strictEqual(mgr.isMacError(undefined), false);

    assert.strictEqual(mgr.parseRetryErrorCode('4'), RetryReason.SignalErrorInvalidMessage);
    assert.strictEqual(mgr.parseRetryErrorCode('7'), RetryReason.SignalErrorBadMac);
    assert.strictEqual(mgr.parseRetryErrorCode('999'), RetryReason.UnknownError);
    assert.strictEqual(mgr.parseRetryErrorCode('invalid'), undefined);
    assert.strictEqual(mgr.parseRetryErrorCode(''), undefined);
    assert.strictEqual(mgr.parseRetryErrorCode(undefined), undefined);
});

test('MessageRetryManager: Session Recreation Decisions & Base Key Tracking', () => {
    const logger = { debug: () => {}, warn: () => {} };
    const mgr = new MessageRetryManager(logger, 2);

    const decNoSession = mgr.shouldRecreateSession('dest1@s.whatsapp.net', false, undefined);
    assert.strictEqual(decNoSession.recreate, true);
    assert.strictEqual(decNoSession.reason, "we don't have a Signal session with them");

    const decMac = mgr.shouldRecreateSession('dest2@s.whatsapp.net', true, RetryReason.SignalErrorInvalidMessage);
    assert.strictEqual(decMac.recreate, true);
    assert.ok(decMac.reason.includes('MAC error (code 4: SignalErrorInvalidMessage)'));

    const decValid = mgr.shouldRecreateSession('dest2@s.whatsapp.net', true, RetryReason.SignalErrorNoSession);
    assert.strictEqual(decValid.recreate, false);

    assert.strictEqual(mgr.incrementRetryCount('msg_100'), 1);
    assert.strictEqual(mgr.hasExceededMaxRetries('msg_100'), false);
    assert.strictEqual(mgr.incrementRetryCount('msg_100'), 2);
    assert.strictEqual(mgr.hasExceededMaxRetries('msg_100'), true);

    const b1 = Buffer.from([1, 2, 3, 4]);
    const b2 = Buffer.from([1, 2, 3, 4]);
    const b3 = Buffer.from([1, 2, 3, 5]);

    mgr.saveBaseKey('peer', 'msg_100', b1);
    assert.strictEqual(mgr.hasSameBaseKey('peer', 'msg_100', b2), true);
    assert.strictEqual(mgr.hasSameBaseKey('peer', 'msg_100', b3), false);
    mgr.deleteBaseKey('peer', 'msg_100');
    assert.strictEqual(mgr.hasSameBaseKey('peer', 'msg_100', b2), false);
});

await testAsync('IdentityChangeHandler: Companion, Self Primary, Debounce & Offline', async () => {
    const logger = { info: () => {}, debug: () => {}, warn: () => {} };
    const debounceCache = new Map();
    let asserted = false;

    const ctx = {
        logger,
        meId: '628123456789@s.whatsapp.net',
        meLid: '123456789@lid',
        debounceCache,
        validateSession: async () => ({ exists: true }),
        assertSessions: async () => { asserted = true; return true; }
    };

    const companionNode = {
        tag: 'notification',
        attrs: { from: '628999999999:2@s.whatsapp.net' },
        content: [{ tag: 'identity', attrs: {} }]
    };
    const resCompanion = await handleIdentityChange(companionNode, ctx);
    assert.strictEqual(resCompanion.action, 'skipped_companion_device');
    assert.strictEqual(resCompanion.device, 2);

    const selfNode = {
        tag: 'notification',
        attrs: { from: '628123456789@s.whatsapp.net' },
        content: [{ tag: 'identity', attrs: {} }]
    };
    const resSelf = await handleIdentityChange(selfNode, ctx);
    assert.strictEqual(resSelf.action, 'skipped_self_primary');

    const validNode = {
        tag: 'notification',
        attrs: { from: '628777777777@s.whatsapp.net' },
        content: [{ tag: 'identity', attrs: {} }]
    };
    const resValid = await handleIdentityChange(validNode, ctx);
    assert.strictEqual(resValid.action, 'session_refreshed');
    assert.strictEqual(asserted, true);

    const resDebounced = await handleIdentityChange(validNode, ctx);
    assert.strictEqual(resDebounced.action, 'debounced');

    debounceCache.clear();
    const offlineNode = {
        tag: 'notification',
        attrs: { from: '628777777777@s.whatsapp.net', offline: '1' },
        content: [{ tag: 'identity', attrs: {} }]
    };
    const resOffline = await handleIdentityChange(offlineNode, ctx);
    assert.strictEqual(resOffline.action, 'skipped_offline');
});

await testAsync('useMultiFileAuthState: Full Lifecycle, Batch I/O, Buffer Integrity & Granular Isolation', async () => {
    const testDir = path.join(__dirname, 'temp_test_level4_parity_auth');
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

    const { state, saveCreds } = await useMultiFileAuthState(testDir);

    assert.strictEqual(Buffer.isBuffer(state.creds.noiseKey.private), true);
    assert.strictEqual(Buffer.isBuffer(state.creds.signedIdentityKey.private), true);
    assert.strictEqual(Buffer.isBuffer(state.creds.signedPreKey.keyPair.private), true);
    assert.strictEqual(Buffer.isBuffer(state.creds.signedPreKey.signature), true);
    assert.strictEqual(typeof state.creds.registrationId, 'number');
    assert.strictEqual(state.creds.signedPreKey.keyId, 1);

    await saveCreds();

    await state.keys.set({
        'session': {
            'peer1@s.whatsapp.net': { sessionData: Buffer.from([10, 20, 30]) },
            'peer2@s.whatsapp.net': { sessionData: Buffer.from([40, 50, 60]) }
        }
    });

    const sessions = await state.keys.get('session', ['peer1@s.whatsapp.net', 'peer2@s.whatsapp.net', 'peer3@s.whatsapp.net']);
    assert.strictEqual(Buffer.isBuffer(sessions['peer1@s.whatsapp.net'].sessionData), true);
    assert.deepStrictEqual(sessions['peer1@s.whatsapp.net'].sessionData, Buffer.from([10, 20, 30]));
    assert.strictEqual(sessions['peer3@s.whatsapp.net'], null);

    const corruptPath = path.join(testDir, 'session-peer_corrupt.json');
    fs.writeFileSync(corruptPath, 'INVALID JSON DATA');

    const isolatedBatch = await state.keys.get('session', ['peer1@s.whatsapp.net', 'peer_corrupt']);
    assert.strictEqual(Buffer.isBuffer(isolatedBatch['peer1@s.whatsapp.net'].sessionData), true);
    assert.strictEqual(isolatedBatch['peer_corrupt'], null);

    await state.keys.set({
        'session': {
            'peer1@s.whatsapp.net': null
        }
    });
    const afterDelete = await state.keys.get('session', ['peer1@s.whatsapp.net']);
    assert.strictEqual(afterDelete['peer1@s.whatsapp.net'], null);

    const { state: reloadedState } = await useMultiFileAuthState(testDir);
    assert.strictEqual(Buffer.isBuffer(reloadedState.creds.noiseKey.private), true);
    assert.strictEqual(Buffer.isBuffer(reloadedState.creds.signedPreKey.keyPair.private), true);
    assert.strictEqual(Buffer.isBuffer(reloadedState.creds.signedPreKey.signature), true);
    assert.strictEqual(reloadedState.creds.signedPreKey.keyId, 1);

    fs.rmSync(testDir, { recursive: true, force: true });
});

console.log('\n================================================================');
console.log(`>>> ALL ${passCount}/${passCount} LEVEL 4 PARITY TESTS PASSED 100%! <<<`);
console.log('================================================================\n');
