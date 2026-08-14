import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function loadNativeBinding() {
  const platform = process.platform;
  const arch = process.arch;

  const candidatePaths = [
    path.resolve(__dirname, 'baileys_napi.node'),
    path.resolve(__dirname, `baileys_napi.${platform}-${arch}.node`),
    path.resolve(__dirname, `baileys_napi.${platform}-${arch}-gnu.node`),
    path.resolve(__dirname, `baileys_napi.${platform}-${arch}-msvc.node`),
    path.resolve(__dirname, `baileys_napi.${platform}-${arch}-musl.node`),
    path.resolve(__dirname, 'dist-binaries', `baileys_napi.${platform}-${arch}.node`),
    path.resolve(__dirname, 'dist-binaries', `baileys_napi.${platform}-${arch}-gnu.node`),
    path.resolve(__dirname, 'dist-binaries', `baileys_napi.${platform}-${arch}-msvc.node`),
    path.resolve(__dirname, 'binaries', `baileys_napi.${platform}-${arch}.node`),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        return require(candidate);
      } catch (e) {
        // Continue trying next candidate
      }
    }
  }

  try {
    return require(path.resolve(__dirname, 'baileys_napi.node'));
  } catch (err) {
    throw new Error(
      `[Artoria-Baileys] Gagal memuat native binary untuk platform "${platform}-${arch}". ` +
      `Pastikan Anda telah mengompilasi addon via "cargo build --package baileys-napi --release" atau mengunduh prebuilt binary.`
    );
  }
}

const native = loadNativeBinding();

// Re-export full, genuine Baileys implementation
import makeWASocket from './lib/index.js';
export * from './lib/index.js';
export * from './lib/WABinary/jid-utils.js';
export { makeWASocket };
export default makeWASocket;

export const isJidUser = (jid) => jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@lid') || jid?.endsWith('@c.us');

export function makeInMemoryStore(config = {}) {
  const chats = new Map();
  const messages = new Map();
  const contacts = new Map();
  const groupMetadata = new Map();
  const presences = new Map();
  const state = { connection: 'close' };

  return {
    chats,
    messages,
    contacts,
    groupMetadata,
    presences,
    state,
    bind(ev) {
      ev.on('connection.update', (update) => Object.assign(state, update));
      ev.on('chats.set', ({ chats: newChats }) => {
        for (const chat of newChats || []) chats.set(chat.id, chat);
      });
      ev.on('contacts.set', ({ contacts: newContacts }) => {
        for (const contact of newContacts || []) contacts.set(contact.id, contact);
      });
      ev.on('messages.upsert', ({ messages: newMessages }) => {
        for (const msg of newMessages || []) {
          const jid = msg.key?.remoteJid;
          if (jid) {
            if (!messages.has(jid)) messages.set(jid, []);
            messages.get(jid).push(msg);
          }
        }
      });
    },
    loadMessages(jid, count) {
      return (messages.get(jid) || []).slice(-count);
    },
    writeToFile(path) {},
    readFromFile(path) {}
  };
}

// Export native Rust high-performance bindings
export const {
  jidEncode,
  jidDecode,
  jidNormalizedUser,
  decodeBinaryNode,
  encodeBinaryNode,
  encryptMedia,
  decryptMedia,
  buildGroupCreateNode,
  buildGroupParticipantsUpdateNode,
  buildGroupInviteCodeNode,
  buildGroupUpdateSubjectNode,
  buildGroupUpdateDescriptionNode,
  buildGroupSettingUpdateNode,
  buildMuteChatNode,
  buildPinChatNode,
  buildArchiveChatNode,
  buildNewsletterCreateNode,
  buildNewsletterFollowNode,
  buildNewsletterMuteNode,
  buildCommunityCreateNode,
  buildCommunityDeactivateNode,
  buildCommunityLinkGroupsNode,
  buildCommunityUnlinkGroupsNode,
  buildCatalogQueryNode,
  buildProductQueryNode,
  buildCollectionsQueryNode,
  buildOrderDetailsNode,
  buildUsyncQueryNode,
  computePatchMac,
  buildSyncdNode,
  encodeWamEvent,
  buildReceiptNode,
  buildPresenceNode,
  buildPingNode,
  NoiseTransport,
  WhatsAppClient,
  version
} = native;

export const buildUSyncQueryNode = native.buildUsyncQueryNode;
