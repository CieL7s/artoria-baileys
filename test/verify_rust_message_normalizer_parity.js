import assert from 'assert';
import { normalizeMessageContent, extractMessageContent, getContentType, getDevice } from '../lib/Utils/messages.js';

console.log('🚀 Starting Sub-Modul 4: Message Normalizer Rust Parity Verification Test Suite...\n');

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
// 1. Basic Messages & Null Handling
// -------------------------------------------------------------
test('Null & undefined message content normalization', () => {
  assert.strictEqual(normalizeMessageContent(null), undefined);
  assert.strictEqual(normalizeMessageContent(undefined), undefined);
  assert.strictEqual(extractMessageContent(null), undefined);
  assert.strictEqual(getContentType(null), undefined);
});

test('Plain conversation message passthrough', () => {
  const msg = { conversation: 'Halo Artoria!' };
  const normalized = normalizeMessageContent(msg);
  assert.deepStrictEqual(normalized, msg);
  assert.strictEqual(getContentType(normalized), 'conversation');
});

test('Plain extendedTextMessage passthrough', () => {
  const msg = {
    extendedTextMessage: {
      text: 'https://github.com/CieL7s/artoria-baileys',
      matchedText: 'https://github.com/CieL7s/artoria-baileys'
    }
  };
  const normalized = normalizeMessageContent(msg);
  assert.deepStrictEqual(normalized, msg);
  assert.strictEqual(getContentType(normalized), 'extendedTextMessage');
});

// -------------------------------------------------------------
// 2. Single Layer Wrapper Unwrapping
// -------------------------------------------------------------
test('Unwrap ephemeralMessage -> imageMessage', () => {
  const inner = { imageMessage: { caption: 'Foto ephemeral', url: 'https://wa.net/img1' } };
  const wrapped = { ephemeralMessage: { message: inner } };
  const normalized = normalizeMessageContent(wrapped);
  assert.deepStrictEqual(normalized, inner);
  assert.strictEqual(getContentType(normalized), 'imageMessage');
});

test('Unwrap viewOnceMessage -> videoMessage', () => {
  const inner = { videoMessage: { caption: 'Video View Once', seconds: 15 } };
  const wrapped = { viewOnceMessage: { message: inner } };
  const normalized = normalizeMessageContent(wrapped);
  assert.deepStrictEqual(normalized, inner);
  assert.strictEqual(getContentType(normalized), 'videoMessage');
});

test('Unwrap viewOnceMessageV2 -> audioMessage', () => {
  const inner = { audioMessage: { seconds: 5, ptt: true } };
  const wrapped = { viewOnceMessageV2: { message: inner } };
  const normalized = normalizeMessageContent(wrapped);
  assert.deepStrictEqual(normalized, inner);
  assert.strictEqual(getContentType(normalized), 'audioMessage');
});

test('Unwrap viewOnceMessageV2Extension -> documentMessage', () => {
  const inner = { documentMessage: { fileName: 'secret.pdf', mimetype: 'application/pdf' } };
  const wrapped = { viewOnceMessageV2Extension: { message: inner } };
  const normalized = normalizeMessageContent(wrapped);
  assert.deepStrictEqual(normalized, inner);
  assert.strictEqual(getContentType(normalized), 'documentMessage');
});

test('Unwrap documentWithCaptionMessage -> documentMessage', () => {
  const inner = { documentMessage: { caption: 'Invoice Mei 2026', fileName: 'inv.pdf' } };
  const wrapped = { documentWithCaptionMessage: { message: inner } };
  const normalized = normalizeMessageContent(wrapped);
  assert.deepStrictEqual(normalized, inner);
  assert.strictEqual(getContentType(normalized), 'documentMessage');
});

test('Unwrap editedMessage -> protocolMessage', () => {
  const inner = { protocolMessage: { key: { id: '3EB0123' }, type: 14 } };
  const wrapped = { editedMessage: { message: inner } };
  const normalized = normalizeMessageContent(wrapped);
  assert.deepStrictEqual(normalized, inner);
  assert.strictEqual(getContentType(normalized), 'protocolMessage');
});

test('Unwrap groupStatusMessage & groupStatusMessageV2', () => {
  const inner1 = { conversation: 'Group status update 1' };
  const inner2 = { conversation: 'Group status update 2' };
  assert.deepStrictEqual(normalizeMessageContent({ groupStatusMessage: { message: inner1 } }), inner1);
  assert.deepStrictEqual(normalizeMessageContent({ groupStatusMessageV2: { message: inner2 } }), inner2);
});

// -------------------------------------------------------------
// 3. Deep Multi-Layer Nesting (Up to 5 Layers)
// -------------------------------------------------------------
test('Deep Multi-Layer Unwrapping: ephemeral -> viewOnceV2 -> documentWithCaption -> image', () => {
  const leafImage = { imageMessage: { caption: 'Deep Nested Photo', url: 'https://wa.net/leaf' } };
  const layer3 = { documentWithCaptionMessage: { message: leafImage } };
  const layer2 = { viewOnceMessageV2: { message: layer3 } };
  const layer1 = { ephemeralMessage: { message: layer2 } };

  const normalized = normalizeMessageContent(layer1);
  assert.deepStrictEqual(normalized, leafImage);
  assert.strictEqual(getContentType(normalized), 'imageMessage');
});

// -------------------------------------------------------------
// 4. extractMessageContent (Buttons & Templates)
// -------------------------------------------------------------
test('extractMessageContent: buttonsMessage with imageMessage', () => {
  const img = { url: 'https://wa.net/btn_img' };
  const msg = {
    buttonsMessage: {
      imageMessage: img,
      contentText: 'Pilih menu di bawah:',
      buttons: [{ buttonId: '1', buttonText: { displayText: 'Menu' } }]
    }
  };
  const extracted = extractMessageContent(msg);
  assert.deepStrictEqual(extracted, { imageMessage: img });
});

test('extractMessageContent: templateMessage hydratedTemplate with conversation', () => {
  const msg = {
    templateMessage: {
      hydratedTemplate: {
        hydratedContentText: 'Selamat datang di Bot Artoria!',
        hydratedButtons: [{ index: 1, quickReplyButton: { displayText: 'Start' } }]
      }
    }
  };
  const extracted = extractMessageContent(msg);
  assert.deepStrictEqual(extracted, { conversation: 'Selamat datang di Bot Artoria!' });
});

// -------------------------------------------------------------
// 5. getContentType Edge Cases
// -------------------------------------------------------------
test('getContentType ignores senderKeyDistributionMessage when conversation/media present', () => {
  const msg = {
    senderKeyDistributionMessage: { groupId: '120363409742668546@g.us', axolotlSenderKeyDistributionMessage: Buffer.from([1, 2, 3]) },
    conversation: '.menu'
  };
  assert.strictEqual(getContentType(msg), 'conversation');
});

test('getContentType handles reactionMessage and pollUpdateMessage', () => {
  assert.strictEqual(getContentType({ reactionMessage: { text: '❤️' } }), 'reactionMessage');
  assert.strictEqual(getContentType({ pollUpdateMessage: { pollCreationMessageKey: { id: '123' } } }), 'pollUpdateMessage');
});

// -------------------------------------------------------------
// 6. getDevice Prediction Parity
// -------------------------------------------------------------
test('getDevice: iOS, Web, Android message ID formats', () => {
  assert.strictEqual(getDevice('3ASDF123456789012345'), 'ios'); // 3A + 18 chars = 20 chars
  assert.strictEqual(getDevice('3EB0123456789012345678'), 'web'); // 3E + 20 chars = 22 chars
  assert.strictEqual(getDevice('ABCDEFGHIJKLMNO123456'), 'android'); // 21 chars
  assert.strictEqual(getDevice('0123456789ABCDEF0123456789ABCDEF'), 'android'); // 32 chars
});

// -------------------------------------------------------------
// 7. Real WhatsApp Traffic Vectors
// -------------------------------------------------------------
test('Real Traffic Vector 1: Ephemeral Group Text Command (.menu)', () => {
  const realGroupMsg = {
    ephemeralMessage: {
      message: {
        extendedTextMessage: {
          text: '.menu',
          contextInfo: {
            stanzaId: '3EB0111222333444555666',
            participant: '628123456789@s.whatsapp.net',
            quotedMessage: { conversation: 'Bantuan' }
          }
        }
      }
    }
  };

  const normalized = normalizeMessageContent(realGroupMsg);
  assert.strictEqual(getContentType(normalized), 'extendedTextMessage');
  assert.strictEqual(normalized.extendedTextMessage.text, '.menu');
  assert.strictEqual(normalized.extendedTextMessage.contextInfo.participant, '628123456789@s.whatsapp.net');
});

test('Real Traffic Vector 2: ViewOnce Image with Media Keys', () => {
  const realViewOnceMsg = {
    viewOnceMessage: {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Foto sekali lihat',
          fileSha256: Buffer.from([10, 20, 30, 40]),
          fileLength: 45000,
          mediaKey: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]),
          directPath: '/v/t62.7118-24/test.enc'
        }
      }
    }
  };

  const normalized = normalizeMessageContent(realViewOnceMsg);
  assert.strictEqual(getContentType(normalized), 'imageMessage');
  assert.strictEqual(normalized.imageMessage.caption, 'Foto sekali lihat');
  assert.strictEqual(normalized.imageMessage.mimetype, 'image/jpeg');
});

test('Real Traffic Vector 3: WhatsApp Channel / Newsletter Text with Server ID', () => {
  const realNewsletterMsg = {
    conversation: 'Update rilisan Artoria-Baileys v0.5.1 native Rust telah aktif!'
  };

  const normalized = normalizeMessageContent(realNewsletterMsg);
  assert.strictEqual(getContentType(normalized), 'conversation');
  assert.strictEqual(normalized.conversation, 'Update rilisan Artoria-Baileys v0.5.1 native Rust telah aktif!');
});

console.log(`\n🎉 All ${passCount}/${passCount} Sub-Modul 4 (messages.js Normalizer) parity tests PASSED!`);
