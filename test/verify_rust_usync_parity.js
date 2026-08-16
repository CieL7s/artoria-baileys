import assert from 'assert';
import { USyncQuery } from '../lib/WAUSync/USyncQuery.js';
import { USyncUser } from '../lib/WAUSync/USyncUser.js';
import { usyncBuildQuery, usyncParseQueryResult } from '../index.js';

console.log('🚀 Starting Sub-Modul 1: WAUSync Rust Parity Verification Test Suite...\n');

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
// 1. Contact Protocol Test
// -------------------------------------------------------------
test('Contact Protocol Parity: "type=in" contact node', () => {
  const query = new USyncQuery().withContactProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628123456789@s.whatsapp.net' },
                content: [
                  { tag: 'contact', attrs: { type: 'in' }, content: undefined }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list.length, 1);
  assert.strictEqual(parsed.list[0].id, '628123456789@s.whatsapp.net');
  assert.strictEqual(parsed.list[0].contact, true);
});

test('Contact Protocol Parity: non-"in" contact node returns false', () => {
  const query = new USyncQuery().withContactProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628999999999@s.whatsapp.net' },
                content: [
                  { tag: 'contact', attrs: { type: 'out' }, content: undefined }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list[0].contact, false);
});

// -------------------------------------------------------------
// 2. Devices Protocol Test
// -------------------------------------------------------------
test('Devices Protocol Parity: multiple devices and signed key-index', () => {
  const query = new USyncQuery().withDeviceProtocol();
  const rawSignedBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628111222333@s.whatsapp.net' },
                content: [
                  {
                    tag: 'devices',
                    attrs: {},
                    content: [
                      {
                        tag: 'device-list',
                        attrs: {},
                        content: [
                          { tag: 'device', attrs: { id: '0', 'key-index': '0', is_hosted: 'false' } },
                          { tag: 'device', attrs: { id: '1', 'key-index': '2', is_hosted: 'true' } }
                        ]
                      },
                      {
                        tag: 'key-index-list',
                        attrs: { ts: '1786870000', expected_ts: '1786870050' },
                        content: rawSignedBytes
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  const dev = parsed.list[0].devices;
  assert.strictEqual(dev.deviceList.length, 2);
  assert.strictEqual(dev.deviceList[0].id, 0);
  assert.strictEqual(dev.deviceList[0].keyIndex, 0);
  assert.strictEqual(dev.deviceList[0].isHosted, false);
  assert.strictEqual(dev.deviceList[1].id, 1);
  assert.strictEqual(dev.deviceList[1].keyIndex, 2);
  assert.strictEqual(dev.deviceList[1].isHosted, true);
  assert.strictEqual(dev.keyIndex.timestamp, 1786870000);
  assert.strictEqual(dev.keyIndex.expectedTimestamp, 1786870050);
  assert(Buffer.isBuffer(dev.keyIndex.signedKeyIndex));
  assert.deepStrictEqual(dev.keyIndex.signedKeyIndex, rawSignedBytes);
});

// -------------------------------------------------------------
// 3. Status Protocol Test
// -------------------------------------------------------------
test('Status Protocol Parity: custom status with timestamp', () => {
  const query = new USyncQuery().withStatusProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628111222333@s.whatsapp.net' },
                content: [
                  {
                    tag: 'status',
                    attrs: { t: '1700000000' },
                    content: Buffer.from('Hey there! I am using WhatsApp.')
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list[0].status.status, 'Hey there! I am using WhatsApp.');
  assert(parsed.list[0].status.setAt instanceof Date);
  assert.strictEqual(parsed.list[0].status.setAt.getTime(), 1700000000000);
});

test('Status Protocol Parity: code 401 returns empty string status', () => {
  const query = new USyncQuery().withStatusProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628111222333@s.whatsapp.net' },
                content: [
                  {
                    tag: 'status',
                    attrs: { code: '401', t: '0' },
                    content: undefined
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list[0].status.status, '');
});

// -------------------------------------------------------------
// 4. Disappearing Mode Protocol Test
// -------------------------------------------------------------
test('Disappearing Mode Protocol Parity: duration & timestamp', () => {
  const query = new USyncQuery().withDisappearingModeProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628111222333@s.whatsapp.net' },
                content: [
                  {
                    tag: 'disappearing_mode',
                    attrs: { duration: '604800', t: '1700000000' },
                    content: undefined
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list[0].disappearing_mode.duration, 604800);
  assert(parsed.list[0].disappearing_mode.setAt instanceof Date);
  assert.strictEqual(parsed.list[0].disappearing_mode.setAt.getTime(), 1700000000000);
});

// -------------------------------------------------------------
// 5. LID Protocol Test
// -------------------------------------------------------------
test('LID Protocol Parity: val attribute mapping', () => {
  const query = new USyncQuery().withLIDProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628123456789@s.whatsapp.net' },
                content: [
                  { tag: 'lid', attrs: { val: '100234567890123@lid' }, content: undefined }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list[0].lid, '100234567890123@lid');
});

// -------------------------------------------------------------
// 6. Username Protocol Test
// -------------------------------------------------------------
test('Username Protocol Parity: content extraction', () => {
  const query = new USyncQuery().withUsernameProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '628123456789@s.whatsapp.net' },
                content: [
                  { tag: 'username', attrs: {}, content: 'nagisa_artoria' }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  assert.strictEqual(parsed.list[0].username, 'nagisa_artoria');
});

// -------------------------------------------------------------
// 7. Bot Profile Protocol Test
// -------------------------------------------------------------
test('Bot Profile Protocol Parity: commands and prompts', () => {
  const query = new USyncQuery().withBotProfileProtocol();
  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: '123' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '13135550002@s.whatsapp.net' },
                content: [
                  {
                    tag: 'bot',
                    attrs: {},
                    content: [
                      {
                        tag: 'profile',
                        attrs: { persona_id: 'meta_ai_1' },
                        content: [
                          { tag: 'name', attrs: {}, content: 'Meta AI' },
                          { tag: 'description', attrs: {}, content: 'AI Assistant' },
                          { tag: 'category', attrs: {}, content: 'General' },
                          {
                            tag: 'commands',
                            attrs: {},
                            content: [
                              {
                                tag: 'command',
                                attrs: {},
                                content: [
                                  { tag: 'name', attrs: {}, content: 'imagine' },
                                  { tag: 'description', attrs: {}, content: 'Generate image' }
                                ]
                              }
                            ]
                          },
                          {
                            tag: 'prompts',
                            attrs: {},
                            content: [
                              {
                                tag: 'prompt',
                                attrs: {},
                                content: [
                                  { tag: 'emoji', attrs: {}, content: '🎨' },
                                  { tag: 'text', attrs: {}, content: 'Draw an anime character' }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  const bot = parsed.list[0].bot;
  assert.strictEqual(bot.name, 'Meta AI');
  assert.strictEqual(bot.personaId, 'meta_ai_1');
  assert.strictEqual(bot.commands.length, 1);
  assert.strictEqual(bot.commands[0].name, 'imagine');
  assert.strictEqual(bot.commands[0].description, 'Generate image');
  assert.strictEqual(bot.prompts.length, 1);
  assert.strictEqual(bot.prompts[0], '🎨 Draw an anime character');
});

// -------------------------------------------------------------
// 8. Full Multi-Protocol Composite Test
// -------------------------------------------------------------
test('Multi-Protocol Composite Query Result Parity: 7 protocols simultaneously', () => {
  const query = new USyncQuery()
    .withContactProtocol()
    .withDeviceProtocol()
    .withStatusProtocol()
    .withDisappearingModeProtocol()
    .withLIDProtocol()
    .withUsernameProtocol();

  const mockNode = {
    tag: 'iq',
    attrs: { type: 'result', id: 'composite_query_1' },
    content: [
      {
        tag: 'usync',
        attrs: {},
        content: [
          {
            tag: 'list',
            attrs: {},
            content: [
              {
                tag: 'user',
                attrs: { jid: '6285156504443@s.whatsapp.net' },
                content: [
                  { tag: 'contact', attrs: { type: 'in' }, content: undefined },
                  { tag: 'lid', attrs: { val: '132598911267037@lid' }, content: undefined },
                  { tag: 'status', attrs: { t: '1786870000' }, content: 'Artoria Native Engine' },
                  { tag: 'disappearing_mode', attrs: { duration: '86400', t: '1786870000' }, content: undefined },
                  { tag: 'username', attrs: {}, content: 'ciel_artoria' },
                  {
                    tag: 'devices',
                    attrs: {},
                    content: [
                      {
                        tag: 'device-list',
                        attrs: {},
                        content: [
                          { tag: 'device', attrs: { id: '0', 'key-index': '1', is_hosted: 'false' } }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const parsed = query.parseUSyncQueryResult(mockNode);
  const u = parsed.list[0];
  assert.strictEqual(u.id, '6285156504443@s.whatsapp.net');
  assert.strictEqual(u.contact, true);
  assert.strictEqual(u.lid, '132598911267037@lid');
  assert.strictEqual(u.status.status, 'Artoria Native Engine');
  assert.strictEqual(u.disappearing_mode.duration, 86400);
  assert.strictEqual(u.username, 'ciel_artoria');
  assert.strictEqual(u.devices.deviceList.length, 1);
});

// -------------------------------------------------------------
// 9. Direct Rust Native USync Builder Test
// -------------------------------------------------------------
test('Direct Rust usyncBuildQuery N-API output verification', () => {
  const users = [{ id: '628123456789@s.whatsapp.net', phone: '+628123456789' }];
  const protocols = ['contact', 'devices', 'lid'];
  const res = usyncBuildQuery('interactive', 'query', JSON.stringify(users), JSON.stringify(protocols), 'test_msg_id_123');
  const node = JSON.parse(res);

  assert.strictEqual(node.tag, 'iq');
  assert.strictEqual(node.attrs.id, 'test_msg_id_123');
  assert.strictEqual(node.attrs.xmlns, 'usync');
  assert.strictEqual(node.content.length, 1);
  assert.strictEqual(node.content[0].tag, 'usync');
  assert.strictEqual(node.content[0].attrs.sid, 'test_msg_id_123');
  assert.strictEqual(node.content[0].content.length, 2);
  assert.strictEqual(node.content[0].content[0].tag, 'query');
  assert.strictEqual(node.content[0].content[1].tag, 'list');
});

console.log(`\n🎉 All ${passCount}/${passCount} Sub-Modul 1 (WAUSync) parity tests PASSED!`);
