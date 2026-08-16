import assert from 'assert';
import { decodeMessageNode, extractAddressingContext } from '../lib/Utils/decode-wa-message.js';

console.log('🚀 Starting Sub-Modul 2: decode-wa-message Rust Parity Verification Test Suite...\n');

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

const ME_PN = '62811111111:0@s.whatsapp.net';
const ME_LID = '100111111111111:0@lid';

// -------------------------------------------------------------
// 1. Pesan dari Kontak PN Biasa (Belum Ada LID Mapping)
// -------------------------------------------------------------
test('Case 1: Standard 1:1 PN Message (Incoming)', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB01234567890ABCDEF',
      from: '628123456789@s.whatsapp.net',
      t: '1740000000',
      notify: 'Budi Santoso'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.author, '628123456789@s.whatsapp.net');
  assert.strictEqual(decoded.sender, '628123456789@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '628123456789@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.fromMe, false);
  assert.strictEqual(decoded.fullMessage.key.id, '3EB01234567890ABCDEF');
  assert.strictEqual(decoded.fullMessage.key.addressingMode, 'pn');
  assert.strictEqual(decoded.fullMessage.pushName, 'Budi Santoso');
  assert.strictEqual(decoded.fullMessage.messageTimestamp, 1740000000);
});

// -------------------------------------------------------------
// 2. Pesan dari Kontak yang Punya LID Mapping (senderAlt / recipientAlt)
// -------------------------------------------------------------
test('Case 2: 1:1 LID-Addressed Message with sender_pn Alt', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0LIDMSG001',
      from: '100234567890123@lid',
      sender_pn: '628987654321@s.whatsapp.net',
      addressing_mode: 'lid',
      t: '1740000100',
      notify: 'Citra'
    },
    content: []
  };

  const ctx = extractAddressingContext(stanza);
  assert.strictEqual(ctx.addressingMode, 'lid');
  assert.strictEqual(ctx.senderAlt, '628987654321@s.whatsapp.net');

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.author, '100234567890123@lid');
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '100234567890123@lid');
  assert.strictEqual(decoded.fullMessage.key.remoteJidAlt, '628987654321@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.addressingMode, 'lid');
});

test('Case 2b: 1:1 PN-Addressed Message with sender_lid Alt', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0PNMSG002',
      from: '628987654321@s.whatsapp.net',
      sender_lid: '100234567890123@lid',
      addressing_mode: 'pn',
      t: '1740000200'
    },
    content: []
  };

  const ctx = extractAddressingContext(stanza);
  assert.strictEqual(ctx.addressingMode, 'pn');
  assert.strictEqual(ctx.senderAlt, '100234567890123@lid');

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.fullMessage.key.remoteJidAlt, '100234567890123@lid');
  assert.strictEqual(decoded.fullMessage.key.addressingMode, 'pn');
});

// -------------------------------------------------------------
// 3. Pesan Grup dengan Participant Campuran (PN & LID)
// -------------------------------------------------------------
test('Case 3a: Group Message from PN Participant', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0GRP001',
      from: '120363024823904@g.us',
      participant: '628123456789:4@s.whatsapp.net',
      participant_lid: '100999999999999@lid',
      addressing_mode: 'pn',
      t: '1740000300',
      notify: 'Dimas'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.sender, '120363024823904@g.us');
  assert.strictEqual(decoded.author, '628123456789:4@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '120363024823904@g.us');
  assert.strictEqual(decoded.fullMessage.key.participant, '628123456789:4@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.participantAlt, '100999999999999@lid');
  assert.strictEqual(decoded.fullMessage.key.remoteJidAlt, undefined); // In group, remoteJidAlt is undefined
  assert.strictEqual(decoded.fullMessage.key.fromMe, false);
});

test('Case 3b: Group Message from LID Participant', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0GRP002',
      from: '120363024823904@g.us',
      participant: '200888888888888:12@lid',
      participant_pn: '628555555555@s.whatsapp.net',
      addressing_mode: 'lid',
      t: '1740000400',
      notify: 'Eka'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.author, '200888888888888:12@lid');
  assert.strictEqual(decoded.fullMessage.key.participant, '200888888888888:12@lid');
  assert.strictEqual(decoded.fullMessage.key.participantAlt, '628555555555@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.addressingMode, 'lid');
});

// -------------------------------------------------------------
// 4. Multi-Device Senders (Device Suffix :10, :16, etc.)
// -------------------------------------------------------------
test('Case 4a: Multi-Device Companion Incoming (:16)', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0MD001',
      from: '628123456789:16@s.whatsapp.net',
      t: '1740000500'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.author, '628123456789:16@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '628123456789:16@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.fromMe, false);
});

test('Case 4b: Multi-Device Self Stanza from Companion Device (:10)', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0MDSELF001',
      from: '62811111111:10@s.whatsapp.net',
      recipient: '628999999999@s.whatsapp.net',
      t: '1740000600'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.fullMessage.key.fromMe, true);
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '628999999999@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.status, 1); // SERVER_ACK
});

// -------------------------------------------------------------
// 5. Newsletter / Channel Messages
// -------------------------------------------------------------
test('Case 5: Newsletter Channel Stanza with server_id', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0NEWS001',
      from: '120363144038483540@newsletter',
      server_id: '125',
      t: '1740000700'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.sender, '120363144038483540@newsletter');
  assert.strictEqual(decoded.author, '120363144038483540@newsletter');
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '120363144038483540@newsletter');
  assert.strictEqual(decoded.fullMessage.key.server_id, '125');
  assert.strictEqual(decoded.fullMessage.key.fromMe, false);
});

// -------------------------------------------------------------
// 6. Broadcast & Status Messages
// -------------------------------------------------------------
test('Case 6a: Status Broadcast from other user', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0STATUS001',
      from: 'status@broadcast',
      participant: '628123456789@s.whatsapp.net',
      t: '1740000800'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.fullMessage.key.remoteJid, 'status@broadcast');
  assert.strictEqual(decoded.fullMessage.broadcast, true);
  assert.strictEqual(decoded.author, '628123456789@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.fromMe, false);
});

test('Case 6b: Status Broadcast from self', () => {
  const stanza = {
    tag: 'message',
    attrs: {
      id: '3EB0STATUSSELF',
      from: 'status@broadcast',
      participant: '62811111111@s.whatsapp.net',
      t: '1740000900'
    },
    content: []
  };

  const decoded = decodeMessageNode(stanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.fullMessage.key.fromMe, true);
  assert.strictEqual(decoded.fullMessage.broadcast, true);
  assert.strictEqual(decoded.fullMessage.status, 1);
});

// -------------------------------------------------------------
// 7. Real WhatsApp Traffic Vectors
// -------------------------------------------------------------
test('Real Traffic Vector 1: Real Group Stanza with LID Addressing', () => {
  const realGroupStanza = {
    tag: 'message',
    attrs: {
      id: '3EB08F7E41C90D2A',
      from: '120363409742668546@g.us',
      participant: '113636714488011@lid',
      participant_pn: '628123456789@s.whatsapp.net',
      addressing_mode: 'lid',
      notify: 'Riel',
      t: '1740001000'
    },
    content: []
  };

  const decoded = decodeMessageNode(realGroupStanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '120363409742668546@g.us');
  assert.strictEqual(decoded.fullMessage.key.participant, '113636714488011@lid');
  assert.strictEqual(decoded.fullMessage.key.participantAlt, '628123456789@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.pushName, 'Riel');
});

test('Real Traffic Vector 2: Real 1:1 Private Message with Peer Username', () => {
  const realPrivateStanza = {
    tag: 'message',
    attrs: {
      id: '3EB029F81E0C93AB',
      from: '628987654321@s.whatsapp.net',
      sender_lid: '221663413149802@lid',
      peer_recipient_username: 'artoria_user',
      addressing_mode: 'pn',
      t: '1740001100'
    },
    content: []
  };

  const decoded = decodeMessageNode(realPrivateStanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.fullMessage.key.remoteJid, '628987654321@s.whatsapp.net');
  assert.strictEqual(decoded.fullMessage.key.remoteJidAlt, '221663413149802@lid');
  assert.strictEqual(decoded.fullMessage.key.remoteJidUsername, 'artoria_user');
});

test('Real Traffic Vector 3: Real WhatsApp Channel Broadcast Stanza', () => {
  const realChannelStanza = {
    tag: 'message',
    attrs: {
      id: '3EB05544332211AA',
      from: '120363144038483540@newsletter',
      server_id: '98765',
      category: 'channel_post',
      t: '1740001200'
    },
    content: []
  };

  const decoded = decodeMessageNode(realChannelStanza, ME_PN, ME_LID);
  assert.strictEqual(decoded.sender, '120363144038483540@newsletter');
  assert.strictEqual(decoded.fullMessage.category, 'channel_post');
  assert.strictEqual(decoded.fullMessage.key.server_id, '98765');
});

console.log(`\n🎉 All ${passCount}/${passCount} Sub-Modul 2 (decode-wa-message) parity tests PASSED!`);
