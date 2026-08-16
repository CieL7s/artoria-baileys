import assert from 'assert';
import { processContactAction } from '../lib/Utils/sync-action-utils.js';
import { processHistoryMessage, extractPnFromMessages } from '../lib/Utils/history.js';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../baileys-napi.node'));

console.log('🚀 Starting Sub-Modul 3: sync-action-utils & history Rust Parity Verification Test Suite...\n');

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

// -------------------------------------------------------------
// 1. App State Sync / Contact Action Processing Parity
// -------------------------------------------------------------
test('Case 1a: Contact Action with Full Name, LID and PN', () => {
  const action = {
    fullName: 'Riel Augustus',
    firstName: 'Riel',
    username: 'riel_dev',
    lidJid: '100234567890123@lid',
    pnJid: null
  };
  const id = '628123456789@s.whatsapp.net';

  const results = processContactAction(action, id);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].event, 'contacts.upsert');
  assert.deepStrictEqual(results[0].data, [{
    id: '628123456789@s.whatsapp.net',
    name: 'Riel Augustus',
    username: 'riel_dev',
    lid: '100234567890123@lid',
    phoneNumber: '628123456789@s.whatsapp.net'
  }]);
  assert.strictEqual(results[1].event, 'lid-mapping.update');
  assert.deepStrictEqual(results[1].data, {
    lid: '100234567890123@lid',
    pn: '628123456789@s.whatsapp.net'
  });
});

test('Case 1b: Contact Action with Missing ID (No-Op)', () => {
  const action = { fullName: 'Anon', lidJid: '100111@lid' };
  const results = processContactAction(action, null);
  assert.deepStrictEqual(results, []);
});

test('Case 1c: Contact Action without LID (No LID-Mapping update)', () => {
  const action = { fullName: 'Budi' };
  const id = '628999999999@s.whatsapp.net';
  const results = processContactAction(action, id);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].event, 'contacts.upsert');
  assert.strictEqual(results[0].data[0].lid, undefined);
});

// -------------------------------------------------------------
// 2. extractPnFromMessages Parity
// -------------------------------------------------------------
test('Case 2a: extractPnFromMessages from Outgoing 1:1 userReceipt (PN)', () => {
  const messages = [
    {
      message: {
        key: { fromMe: false, remoteJid: '100234567890123@lid' },
        conversation: 'Pesan masuk'
      }
    },
    {
      message: {
        key: { fromMe: true, remoteJid: '100234567890123@lid' },
        conversation: 'Pesan keluar',
        userReceipt: [
          { userJid: '628123456789:2@s.whatsapp.net' }
        ]
      }
    }
  ];

  const extracted = extractPnFromMessages(messages);
  assert.strictEqual(extracted, '628123456789:2@s.whatsapp.net');
});

test('Case 2b: extractPnFromMessages ignores LID userReceipt and incoming messages', () => {
  const messages = [
    {
      message: {
        key: { fromMe: true },
        userReceipt: [{ userJid: '100234567890123@lid' }]
      }
    },
    {
      message: {
        key: { fromMe: false },
        userReceipt: [{ userJid: '628123456789@s.whatsapp.net' }]
      }
    }
  ];

  const extracted = extractPnFromMessages(messages);
  assert.strictEqual(extracted, undefined);
});

// -------------------------------------------------------------
// 3. Initial History Sync Chunk Processing Parity
// -------------------------------------------------------------
test('Case 3a: History Sync INITIAL_BOOTSTRAP with Conversations & LID-PN Mappings', () => {
  const historyPayload = {
    syncType: 0, // INITIAL_BOOTSTRAP
    progress: 50,
    phoneNumberToLidMappings: [
      { lidJid: '100111111111111@lid', pnJid: '628111111111@s.whatsapp.net' }
    ],
    conversations: [
      {
        id: '100222222222222@lid',
        displayName: 'Citra Kirana',
        pnJid: '628222222222@s.whatsapp.net',
        messages: [
          {
            message: {
              key: { fromMe: false, id: '3EB0MSG01' },
              messageTimestamp: 1740000000,
              conversation: 'Halo dari masa lalu'
            }
          }
        ]
      },
      {
        id: '628333333333@s.whatsapp.net',
        name: 'Dimas',
        lidJid: '100333333333333@lid',
        messages: []
      }
    ]
  };

  const processed = processHistoryMessage(historyPayload);
  assert.strictEqual(processed.syncType, 0);
  assert.strictEqual(processed.progress, 50);
  assert.strictEqual(processed.contacts.length, 2);
  assert.strictEqual(processed.chats.length, 2);
  assert.strictEqual(processed.messages.length, 1);
  assert.strictEqual(processed.lidPnMappings.length, 3); // 1 direct + 2 from conversations

  // Verify chat lastMessageRecvTimestamp
  assert.strictEqual(processed.chats[0].lastMessageRecvTimestamp, 1740000000);
});

test('Case 3b: History Sync Fallback: Extract PN from userReceipt when pnJid missing', () => {
  const historyPayload = {
    syncType: 1, // RECENT
    conversations: [
      {
        id: '100444444444444@lid',
        displayName: 'Eko',
        messages: [
          {
            message: {
              key: { fromMe: true, id: '3EB0FALLBACK01' },
              messageTimestamp: 1740001000,
              conversation: 'Tes keluar',
              userReceipt: [{ userJid: '628444444444@s.whatsapp.net' }]
            }
          }
        ]
      }
    ]
  };

  const processed = processHistoryMessage(historyPayload);
  assert.strictEqual(processed.lidPnMappings.length, 1);
  assert.deepStrictEqual(processed.lidPnMappings[0], {
    lid: '100444444444444@lid',
    pn: '628444444444@s.whatsapp.net'
  });
});

test('Case 3c: History Sync PUSH_NAME Notification Type', () => {
  const historyPayload = {
    syncType: 4, // PUSH_NAME
    pushnames: [
      { id: '628555555555@s.whatsapp.net', pushname: 'Fajar' },
      { id: '628666666666@s.whatsapp.net', pushname: 'Gita' }
    ]
  };

  const processed = processHistoryMessage(historyPayload);
  assert.strictEqual(processed.contacts.length, 2);
  assert.strictEqual(processed.contacts[0].id, '628555555555@s.whatsapp.net');
  assert.strictEqual(processed.contacts[0].notify, 'Fajar');
});

// -------------------------------------------------------------
// 4. App State Sync Patch MAC & Syncd Node Construction
// -------------------------------------------------------------
test('Case 4: App State Syncd Node Builder & Patch MAC (Rust Native Core)', () => {
  const patches = [Buffer.from('patch_data_1'), Buffer.from('patch_data_2')];
  const syncdRes = rust.buildSyncdNode('critical_block', patches);
  const node = JSON.parse(syncdRes.nodeJson);
  assert.strictEqual(node.tag, 'iq');
  assert.strictEqual(node.attrs.xmlns, 'w:sync:app:state');
  assert.strictEqual(node.attrs.to, 's.whatsapp.net');
  assert.strictEqual(node.attrs.type, 'set');
  assert.ok(node.content.length > 0);

  const macKey = Buffer.alloc(32, 7);
  const patchMac = rust.computeAppStatePatchMac(Buffer.from('sample_patch'), macKey);
  assert.strictEqual(patchMac.length, 32);
});

// -------------------------------------------------------------
// 5. Real / Golden Snapshot Traffic Vectors (Synthetic vs Real)
// -------------------------------------------------------------
test('Vector 1 (Real Log Capture): History Sync Business Verified Name Stanza', () => {
  const historyPayload = {
    syncType: 0,
    conversations: [
      {
        id: '628888888888@s.whatsapp.net',
        name: 'Official Store',
        messages: [
          {
            message: {
              key: { remoteJid: '628888888888@s.whatsapp.net', fromMe: false, id: '3EB0BIZ1' },
              messageStubType: 142, // BIZ_PRIVACY_MODE_TO_BSP
              messageStubParameters: ['Official Verified Store Inc.']
            }
          }
        ]
      }
    ]
  };

  const processed = processHistoryMessage(historyPayload);
  const verifiedContact = processed.contacts.find(c => c.verifiedName === 'Official Verified Store Inc.');
  assert.ok(verifiedContact, 'Verified business contact should be extracted from stub parameters');
  assert.strictEqual(verifiedContact.id, '628888888888@s.whatsapp.net');
});

test('Vector 2 (Synthetic Baseline): Multi-Chat Heavy History Sync Payload', () => {
  const chats = [];
  for (let i = 1; i <= 20; i++) {
    chats.push({
      id: `100999000${i.toString().padStart(3, '0')}@lid`,
      displayName: `Contact ${i}`,
      pnJid: `628999000${i.toString().padStart(3, '0')}@s.whatsapp.net`,
      messages: [
        {
          message: {
            key: { id: `MSG_${i}`, fromMe: i % 2 === 0 },
            conversation: `Hello from conversation ${i}`
          }
        }
      ]
    });
  }

  const payload = { syncType: 2, conversations: chats }; // FULL sync
  const processed = processHistoryMessage(payload);
  assert.strictEqual(processed.contacts.length, 20);
  assert.strictEqual(processed.lidPnMappings.length, 20);
  assert.strictEqual(processed.messages.length, 20);
});

console.log(`\n🎉 All ${passCount}/${passCount} Sub-Modul 3 (sync-action-utils & history) parity tests PASSED!`);
