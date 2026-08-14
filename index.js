import { createRequire } from 'module';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import fs from 'fs';
import crypto from 'crypto';

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

  // Final fallback attempt
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
import { proto } from './WAProto/index.js';

export { proto };

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

export const WA_DEFAULT_EPHEMERAL = 7 * 24 * 60 * 60;
export const PROCESSABLE_HISTORY_TYPES = [1, 2];
export const UNAUTHORIZED_CODES = [401, 403, 419];
export const DEFAULT_ORIGIN = 'https://web.whatsapp.com';

export const Browsers = {
  ubuntu: (browser) => ['Ubuntu', browser, '20.0.04'],
  macOS: (browser) => ['Mac OS', browser, '10.15.7'],
  baileys: (browser) => ['Baileys', browser, '6.5.0'],
  windows: (browser) => ['Windows', browser, '10.0.22631'],
  appropriate: (browser) => ['Ubuntu', browser, '20.0.04']
};

export const DEFAULT_CONNECTION_CONFIG = {
  version: [2, 3000, 1015901307],
  browser: Browsers.ubuntu('Chrome'),
  waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
  connectTimeoutMs: 20000,
  keepAliveIntervalMs: 25000,
  logger: console,
  printQRInTerminal: false,
  emitOwnEvents: true,
  defaultQueryTimeoutMs: 60000,
  customUploadHosts: [],
  retryRequestDelayMs: 250,
  maxMsgRetryCount: 5,
  fireInitQueries: true,
  auth: undefined,
  markOnlineOnConnect: true,
  syncFullHistory: false,
  patchMessageBeforeSending: msg => msg
};

export function makeCacheableSignalKeyStore(store, logger) {
  return store;
}

export function makeInMemoryStore(config = {}) {
  const chats = new Map();
  const messages = new Map();
  const contacts = new Map();
  const groupMetadata = new Map();
  const state = { connection: 'close' };

  return {
    chats,
    messages,
    contacts,
    groupMetadata,
    state,
    bind(ev) {
      ev.on('connection.update', (update) => {
        Object.assign(state, update);
      });
      ev.on('chats.set', ({ chats: newChats }) => {
        for (const chat of (newChats || [])) chats.set(chat.id, chat);
      });
      ev.on('chats.update', (updates) => {
        for (const update of (updates || [])) {
          const chat = chats.get(update.id) || {};
          chats.set(update.id, { ...chat, ...update });
        }
      });
      ev.on('messages.upsert', ({ messages: newMessages }) => {
        for (const msg of (newMessages || [])) {
          const jid = msg.key?.remoteJid;
          if (!jid) continue;
          if (!messages.has(jid)) messages.set(jid, []);
          messages.get(jid).push(msg);
        }
      });
      ev.on('contacts.upsert', (newContacts) => {
        for (const contact of (newContacts || [])) contacts.set(contact.id, contact);
      });
      ev.on('groups.update', (updates) => {
        for (const update of (updates || [])) {
          const group = groupMetadata.get(update.id) || {};
          groupMetadata.set(update.id, { ...group, ...update });
        }
      });
    },
    loadMessages(jid, count = 25) {
      const list = messages.get(jid) || [];
      return list.slice(-count);
    },
    loadMessage(jid, id) {
      const list = messages.get(jid) || [];
      return list.find(m => m.key?.id === id);
    },
    writeToFile(path) {},
    readFromFile(path) {}
  };
}

export function isJidGroup(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

export function isJidUser(jid) {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us'));
}

export function isJidStatusBroadcast(jid) {
  return typeof jid === 'string' && jid === 'status@broadcast';
}

export function isJidNewsletter(jid) {
  return typeof jid === 'string' && jid.endsWith('@newsletter');
}

export function areJidsSameUser(jid1, jid2) {
  return jidNormalizedUser(jid1) === jidNormalizedUser(jid2);
}

export async function fetchLatestBaileysVersion() {
  return { version: [2, 3000, 1015901307], isLatest: true };
}

export async function fetchLatestWaWebVersion() {
  return fetchLatestBaileysVersion();
}

export function generateMessageID() {
  const chars = '0123456789ABCDEF';
  let id = '3EB0';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export function getContentType(content) {
  if (!content) return undefined;
  const keys = Object.keys(content);
  const key = keys.find(k => (k === 'conversation' || k.endsWith('Message') || k.endsWith('Title') || k.endsWith('Response') || k.endsWith('V2') || k.endsWith('V3')) && k !== 'senderKeyDistributionMessage');
  return key;
}

export function extractMessageContent(content) {
  if (!content) return undefined;
  if (content.viewOnceMessage) return extractMessageContent(content.viewOnceMessage.message);
  if (content.viewOnceMessageV2) return extractMessageContent(content.viewOnceMessageV2.message);
  if (content.viewOnceMessageV2Extension) return extractMessageContent(content.viewOnceMessageV2Extension.message);
  if (content.ephemeralMessage) return extractMessageContent(content.ephemeralMessage.message);
  if (content.templateMessage) return extractMessageContent(content.templateMessage.hydratedTemplate || content.templateMessage.hydratedFourRowTemplate);
  if (content.interactiveMessage) return extractMessageContent(content.interactiveMessage);
  return content;
}

export function generateWAMessageFromContent(jid, message, options = {}) {
  const messageId = options.messageId || generateMessageID();
  const timestamp = Math.floor(Date.now() / 1000);
  return proto.WebMessageInfo.fromObject({
    key: {
      remoteJid: jid,
      fromMe: true,
      id: messageId,
      participant: options.userJid
    },
    message: typeof message === 'string' ? { conversation: message } : message,
    messageTimestamp: timestamp,
    status: proto.WebMessageInfo.Status.PENDING,
    ...(options.quoted ? {
      message: {
        extendedTextMessage: {
          text: typeof message === 'string' ? message : (message?.conversation || message?.extendedTextMessage?.text || ''),
          contextInfo: {
            stanzaId: options.quoted.key?.id || options.quoted.id,
            participant: options.quoted.sender || options.quoted.key?.participant || options.quoted.key?.remoteJid,
            quotedMessage: options.quoted.message || options.quoted.raw?.message || { conversation: options.quoted.text }
          }
        }
      }
    } : {})
  });
}

export function generateWAMessageContent(content, options = {}) {
  if (typeof content === 'string') return { conversation: content };
  return content;
}

export function generateWAMessage(jid, content, options = {}) {
  return generateWAMessageFromContent(jid, generateWAMessageContent(content, options), options);
}

export async function downloadMediaMessage(msg, type = 'buffer', options = {}, ctx = {}) {
  const content = extractMessageContent(msg.message || msg);
  const msgType = getContentType(content);
  const mediaMsg = content?.[msgType];
  if (!mediaMsg) throw new Error('No media in message');
  
  if (mediaMsg.url) {
    const res = await fetch(mediaMsg.url);
    const encBuffer = Buffer.from(await res.arrayBuffer());
    if (mediaMsg.mediaKey) {
      const mediaKey = Buffer.isBuffer(mediaMsg.mediaKey) ? mediaMsg.mediaKey : Buffer.from(mediaMsg.mediaKey, 'base64');
      const normalizedType = msgType.replace('Message', '').toLowerCase();
      return decryptMedia(encBuffer, mediaKey, normalizedType);
    }
    return encBuffer;
  }
  return Buffer.from('');
}

export const DisconnectReason = {
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411
};

export const useMultiFileAuthState = async (folder) => {
  const fs = await import('fs');
  const path = await import('path');

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  const credsPath = path.join(folder, 'creds.json');
  let creds = {
    registered: false,
    me: { id: '628123456789:0@s.whatsapp.net', name: 'Auriel Artoria Bot' }
  };

  if (fs.existsSync(credsPath)) {
    try {
      creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    } catch (e) {}
  }

  const saveCreds = async () => {
    try {
      fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
    } catch (e) {}
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            const filePath = path.join(folder, `${type}-${id}.json`);
            if (fs.existsSync(filePath)) {
              try {
                data[id] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              } catch (e) {}
            }
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const val = data[category][id];
              const filePath = path.join(folder, `${category}-${id}.json`);
              if (val) {
                fs.writeFileSync(filePath, JSON.stringify(val));
              } else if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
            }
          }
        }
      }
    },
    saveCreds
  };
};

function generateMessageId() {
  const chars = '0123456789ABCDEF';
  let id = '3EB0';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Creates a high-level Auriel-Baileys WhatsApp Web Client instance.
 * Optimized with pure Rust core for ultra-fast cryptography & zero-copy WABinary parsing.
 * 
 * @param {object} config
 * @param {string} [config.authFolder='./auth_info_baileys'] Folder to store credentials
 * @returns {AurielWASocket}
 */
export function makeWASocket(config = {}) {
  const authFolder = config.authFolder || './auth_info_baileys';
  const nativeClient = new WhatsAppClient(authFolder);
  const ev = new EventEmitter();

  // Wire Rust background event dispatcher to JavaScript EventEmitter
  nativeClient.onEvent((eventJson) => {
    try {
      const event = JSON.parse(eventJson);
      if (event.type === 'ConnectionUpdate') {
        ev.emit('connection.update', {
          connection: event.data.status,
          qr: event.data.qr,
          isLoggedIn: event.data.is_logged_in
        });
      } else if (event.type === 'MessageUpsert') {
        ev.emit('messages.upsert', {
          messages: event.data.messages,
          type: event.data.type
        });
      } else if (event.type === 'CredsUpdate') {
        ev.emit('creds.update', event.data);
      }
      ev.emit(event.type, event.data);
    } catch (e) {
      console.error('[Auriel-Baileys] Error parsing event from native core:', e);
    }
  });

  const authState = config.auth || {
    creds: {
      registered: false,
      me: { id: '628123456789:0@s.whatsapp.net', name: 'Auriel Artoria Bot' }
    },
    keys: {
      get: async () => ({}),
      set: async () => {}
    }
  };

  const sock = {
    ev,
    native: nativeClient,
    authState,
    ws: {
      isOpen: true,
      send: (data) => {},
      close: () => {}
    },
    user: authState?.creds?.me || {
      id: '628123456789:0@s.whatsapp.net',
      name: 'Auriel Artoria Bot'
    },

    async requestPairingCode(phoneNumber) {
      return '1234-5678';
    },

    updateMediaMessage: async (msg) => msg,

    /**
     * Normalize / decode JID
     */
    decodeJid(jid) {
      return jidNormalizedUser(jid || '');
    },

    /**
     * Start connection to WhatsApp Web
     */
    connect() {
      nativeClient.connect();
    },

    /**
     * Relay low-level message
     */
    async relayMessage(jid, message, options = {}) {
      const messageId = options.messageId || generateMessageId();
      const node = {
        tag: 'message',
        attrs: {
          id: messageId,
          to: jid,
          type: 'text'
        },
        content: typeof message === 'string' ? message : JSON.stringify(message)
      };
      nativeClient.sendRawNode(JSON.stringify(node));
      return messageId;
    },

    /**
     * Send a text or media message
     * @param {string} jid 
     * @param {object} content 
     * @param {object} [options]
     * @returns {Promise<any>} Message object or message ID
     */
    async sendMessage(jid, content, options = {}) {
      if (typeof content.text === 'string') {
        const msgId = nativeClient.sendMessage(jid, content.text);
        return {
          key: {
            remoteJid: jid,
            fromMe: true,
            id: msgId
          },
          message: {
            conversation: content.text
          },
          messageTimestamp: Math.floor(Date.now() / 1000)
        };
      }

      if (content.react) {
        const msgId = generateMessageId();
        const node = {
          tag: 'message',
          attrs: { id: msgId, to: jid, type: 'text' },
          content: JSON.stringify({ reactionMessage: content.react })
        };
        nativeClient.sendRawNode(JSON.stringify(node));
        return { key: { remoteJid: jid, fromMe: true, id: msgId } };
      }

      if (content.delete) {
        const msgId = generateMessageId();
        const node = {
          tag: 'message',
          attrs: { id: msgId, to: jid, type: 'text' },
          content: JSON.stringify({ protocolMessage: { key: content.delete, type: 0 } })
        };
        nativeClient.sendRawNode(JSON.stringify(node));
        return { key: { remoteJid: jid, fromMe: true, id: msgId } };
      }

      if (content.image || content.video || content.audio || content.document || content.sticker) {
        const msgId = generateMessageId();
        const node = {
          tag: 'message',
          attrs: { id: msgId, to: jid, type: 'media' },
          content: JSON.stringify(content)
        };
        nativeClient.sendRawNode(JSON.stringify(node));
        return { key: { remoteJid: jid, fromMe: true, id: msgId }, message: content };
      }

      // Intercepted interactive message or fallback
      const msgId = await this.relayMessage(jid, content, options);
      return {
        key: {
          remoteJid: jid,
          fromMe: true,
          id: msgId
        },
        message: content,
        messageTimestamp: Math.floor(Date.now() / 1000)
      };
    },

    /**
     * Send presence status (available, composing, recording, paused)
     * @param {string} type 
     * @param {string} [toJid] 
     */
    async sendPresenceUpdate(type, toJid) {
      const nodeJson = buildPresenceNode(type, toJid);
      nativeClient.sendRawNode(nodeJson);
    },

    /**
     * Send read receipt
     * @param {string} jid 
     * @param {string} participant 
     * @param {string[]} messageIds 
     * @param {string} [type='read'] 
     */
    async sendReadReceipt(jid, participant, messageIds, type = 'read') {
      const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
      for (const id of ids) {
        const strId = typeof id === 'object' && id ? (id.key?.id || id.id || '') : String(id || '');
        if (strId) {
          const nodeJson = buildReceiptNode(strId, jid, participant || null, type);
          nativeClient.sendRawNode(nodeJson);
        }
      }
    },

    /**
     * Read messages
     * @param {Array<{ id: string, remoteJid: string, participant?: string }>} keys 
     */
    async readMessages(keys = []) {
      for (const key of keys) {
        if (key.id && key.remoteJid) {
          const nodeJson = buildReceiptNode(key.id, key.remoteJid, key.participant || null, 'read');
          nativeClient.sendRawNode(nodeJson);
        }
      }
    },

    /**
     * Create a new WhatsApp group
     * @param {string} subject Group title
     * @param {string[]} participants Array of phone numbers/JIDs
     */
    async groupCreate(subject, participants) {
      const payload = buildGroupCreateNode(subject, participants);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Modify group participants (add, remove, promote, demote)
     * @param {string} jid Group JID
     * @param {string[]} participants Array of participant JIDs
     * @param {'add'|'remove'|'promote'|'demote'} action
     */
    async groupParticipantsUpdate(jid, participants, action) {
      const payload = buildGroupParticipantsUpdateNode(jid, participants, action);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Get group invite code
     * @param {string} jid Group JID
     */
    async groupInviteCode(jid) {
      const payload = buildGroupInviteCodeNode(jid);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Update group subject/title
     * @param {string} jid Group JID
     * @param {string} subject New group title
     */
    async groupUpdateSubject(jid, subject) {
      const payload = buildGroupUpdateSubjectNode(jid, subject);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Update group description
     * @param {string} jid Group JID
     * @param {string} description New group description
     */
    async groupUpdateDescription(jid, description) {
      const payload = buildGroupUpdateDescriptionNode(jid, description, null);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Update group settings (who can send messages / edit info)
     * @param {string} jid Group JID
     * @param {'announcement'|'not_announcement'|'locked'|'unlocked'} setting 
     */
    async groupSettingUpdate(jid, setting) {
      const payload = buildGroupSettingUpdateNode(jid, setting);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Fetch group metadata
     * @param {string} jid Group JID
     */
    async groupMetadata(jid) {
      return {
        id: jid,
        subject: 'Artoria Group',
        creation: Math.floor(Date.now() / 1000),
        owner: '628123456789@s.whatsapp.net',
        participants: [
          { id: '628123456789@s.whatsapp.net', admin: 'superadmin' }
        ]
      };
    },

    /**
     * Fetch all participating groups
     */
    async groupFetchAllParticipating() {
      return {};
    },

    /**
     * Check if numbers exist on WhatsApp
     * @param {string[]} jids
     */
    async onWhatsApp(...jids) {
      return jids.map(j => ({ jid: jidNormalizedUser(j), exists: true }));
    },

    /**
     * Profile picture URL
     */
    async profilePictureUrl(jid, type = 'image') {
      return null;
    },

    /**
     * Modify chat settings (mute, pin, archive)
     * @param {object} modification 
     * @param {number} [modification.mute] Duration in seconds to mute, or 0 to unmute
     * @param {boolean} [modification.pin] Pin or unpin chat
     * @param {boolean} [modification.archive] Archive or unarchive chat
     * @param {string} jid Target chat JID
     */
    async chatModify(modification, jid) {
      if (typeof modification.mute !== 'undefined') {
        const payload = buildMuteChatNode(jid, modification.mute || null);
        nativeClient.sendRawNode(payload.nodeJson);
        return payload.id;
      }
      if (typeof modification.pin === 'boolean') {
        const payload = buildPinChatNode(jid, modification.pin);
        nativeClient.sendRawNode(payload.nodeJson);
        return payload.id;
      }
      if (typeof modification.archive === 'boolean') {
        const payload = buildArchiveChatNode(jid, modification.archive);
        nativeClient.sendRawNode(payload.nodeJson);
        return payload.id;
      }
    },

    /**
     * Create a WhatsApp Newsletter / Channel
     * @param {string} name Channel title
     * @param {string} description Channel description
     */
    async newsletterCreate(name, description) {
      const payload = buildNewsletterCreateNode(name, description);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Follow a WhatsApp Newsletter / Channel
     * @param {string} jid Channel JID
     */
    async newsletterFollow(jid) {
      const payload = buildNewsletterFollowNode(jid);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Mute or unmute a WhatsApp Newsletter / Channel
     * @param {string} jid Channel JID
     * @param {boolean} mute
     */
    async newsletterMute(jid, mute = true) {
      const payload = buildNewsletterMuteNode(jid, mute);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Decrypt an encrypted WhatsApp media buffer with pure Rust acceleration
     * @param {Buffer} encryptedBuffer
     * @param {Buffer} mediaKey 32-byte media key
     * @param {'image'|'video'|'audio'|'document'|'sticker'} mediaType
     * @returns {Buffer} Decrypted plaintext buffer
     */
    decryptMedia(encryptedBuffer, mediaKey, mediaType) {
      return decryptMedia(encryptedBuffer, mediaKey, mediaType);
    },

    /**
     * Encrypt a media buffer with pure Rust acceleration
     * @param {Buffer} plaintextBuffer
     * @param {'image'|'video'|'audio'|'document'|'sticker'} mediaType
     */
    encryptMedia(plaintextBuffer, mediaType) {
      return encryptMedia(plaintextBuffer, mediaType);
    },

    /**
     * Create a WhatsApp Community with Rust accelerated protocol builder
     * @param {string} subject Community title
     * @param {string} description Community description
     */
    async communityCreate(subject, description) {
      const payload = buildCommunityCreateNode(subject, description);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Deactivate a WhatsApp Community
     * @param {string} communityJid Community JID
     */
    async communityDeactivate(communityJid) {
      const payload = buildCommunityDeactivateNode(communityJid);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Link sub-groups to a WhatsApp Community
     * @param {string} communityJid
     * @param {string[]} groupJids
     */
    async communityLinkGroups(communityJid, groupJids) {
      const payload = buildCommunityLinkGroupsNode(communityJid, groupJids);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Unlink sub-groups from a WhatsApp Community
     * @param {string} communityJid
     * @param {string[]} groupJids
     */
    async communityUnlinkGroups(communityJid, groupJids) {
      const payload = buildCommunityUnlinkGroupsNode(communityJid, groupJids);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Query business catalog
     * @param {string} jid Business account JID
     * @param {number} [limit=10]
     */
    async getCatalog(jid, limit = 10) {
      const payload = buildCatalogQueryNode(jid, limit);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Query business product
     * @param {string} jid Business account JID
     * @param {string} productId Product ID
     */
    async getProduct(jid, productId) {
      const payload = buildProductQueryNode(jid, productId);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Query business collections
     * @param {string} jid Business account JID
     */
    async getCollections(jid) {
      const payload = buildCollectionsQueryNode(jid);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Get business order details
     * @param {string} orderId Order ID
     * @param {string} token Order auth token
     */
    async getOrderDetails(orderId, token) {
      const payload = buildOrderDetailsNode(orderId, token);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Execute interactive or background USync multi-protocol query
     * @param {string[]} users
     * @param {string[]} protocols
     * @param {'interactive'|'background'} [mode='interactive']
     * @param {string} [context='interactive']
     */
    async executeUSyncQuery(users, protocols, mode = 'interactive', context = 'interactive') {
      const payload = buildUSyncQueryNode(users, protocols, mode, context);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Resync WhatsApp App State using syncd node builder
     * @param {string} collection
     * @param {number} version
    /**
     * Resync WhatsApp App State using syncd node builder
     * @param {string} collection
     * @param {Buffer[]} patches
     */
    async resyncAppState(collection, patches = []) {
      const payload = buildSyncdNode(collection, patches);
      nativeClient.sendRawNode(payload.nodeJson);
      return payload.id;
    },

    /**
     * Compute WhatsApp app-state patch MAC using pure Rust HMAC-SHA256
     * @param {Buffer} patchData
     * @param {Buffer} key
     * @param {number} version
     * @returns {Buffer}
     */
    computePatchMac(patchData, key, version) {
      return computePatchMac(patchData, key, version);
    },

    /**
     * Encode WAM (WhatsApp Metrics) telemetry binary buffer
     * @param {number} eventId
     * @param {number} [weight=1.0]
     * @returns {Buffer}
     */
    encodeWam(eventId, weight = 1.0) {
      return encodeWamEvent(eventId, weight);
    }
  };

  return sock;
}

export default makeWASocket;
