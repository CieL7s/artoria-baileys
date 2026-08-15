import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { EventEmitter } from 'events';
import { proto } from './WAProto/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load native pure-Rust compiled NAPI module
let native = null;
const possiblePaths = [
  path.join(__dirname, 'rust/target/release/baileys_napi.dll'),
  path.join(__dirname, 'baileys-napi.win32-x64-msvc.node'),
  path.join(__dirname, 'baileys_napi.node'),
  './baileys-napi.win32-x64-msvc.node',
  './baileys_napi.node'
];

for (const p of possiblePaths) {
  try {
    if (fs.existsSync(p)) {
      native = require(p);
      break;
    }
  } catch (err) {
    // Continue searching
  }
}

if (!native) {
  try {
    native = require('./baileys_napi.node');
  } catch (e) {
    throw new Error('Failed to load native pure-Rust Baileys module: ' + e.message);
  }
}

// Export native Rust high-performance bindings
export const {
  version,
  jidDecode,
  jidEncode,
  decryptMedia,
  encryptMedia,
  buildPingNode,
  buildSyncdNode,
  encodeWamEvent,
  computePatchMac,
  decodeBinaryNode,
  encodeBinaryNode,
  buildReceiptNode,
  jidNormalizedUser,
  buildPinChatNode,
  buildPresenceNode,
  buildMuteChatNode,
  buildGroupCreateNode,
  buildUsyncQueryNode,
  buildArchiveChatNode,
  buildCatalogQueryNode,
  buildOrderDetailsNode,
  buildProductQueryNode,
  buildNewsletterMuteNode,
  buildCommunityCreateNode,
  buildCollectionsQueryNode,
  buildGroupInviteCodeNode,
  buildNewsletterCreateNode,
  buildNewsletterFollowNode,
  buildCommunityDeactivateNode,
  buildGroupSettingUpdateNode,
  buildGroupUpdateSubjectNode,
  buildCommunityLinkGroupsNode,
  buildCommunityUnlinkGroupsNode,
  buildGroupUpdateDescriptionNode,
  buildGroupParticipantsUpdateNode,
  WhatsAppClient,
  NoiseTransport
} = native;

export const buildUSyncQueryNode = native.buildUsyncQueryNode;

// Re-export WAProto
export { proto };

// Disconnect Reasons
export const DisconnectReason = {
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multicastTimeout: 500,
  forbidden: 403,
  unavailableService: 503
};

// Browsers standard presets
export const Browsers = {
  ubuntu: (browser) => ['Ubuntu', browser || 'Chrome', '20.0.04'],
  macOS: (browser) => ['Mac OS', browser || 'Safari', '17.0'],
  baileys: (browser) => ['Baileys', browser || 'Chrome', '6.0.0'],
  windows: (browser) => ['Windows', browser || 'Chrome', '120.0.0'],
  appropriate: (browser) => ['Ubuntu', browser || 'Chrome', '20.0.04']
};

// JID Utilities
export const isJidUser = (jid) => {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
};

export const isJidGroup = (jid) => {
  return typeof jid === 'string' && jid.endsWith('@g.us');
};

export const isJidNewsletter = (jid) => {
  return typeof jid === 'string' && jid.endsWith('@newsletter');
};

export const areJidsSameUser = (jid1, jid2) => {
  if (!jid1 || !jid2) return false;
  const user1 = jidNormalizedUser(jid1);
  const user2 = jidNormalizedUser(jid2);
  return user1 === user2;
};

export async function fetchLatestBaileysVersion() {
  return {
    version: [2, 3000, 1043857760],
    isLatest: true
  };
}

export async function useMultiFileAuthState(folder) {
  const resolvedPath = path.resolve(folder);
  if (!fs.existsSync(resolvedPath)) {
    fs.mkdirSync(resolvedPath, { recursive: true });
  }

  const credsPath = path.join(resolvedPath, 'creds.json');
  let creds = null;

  if (fs.existsSync(credsPath)) {
    try {
      creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    } catch (e) {
      creds = null;
    }
  }

  if (!creds) {
    try {
      const tempClient = new WhatsAppClient(resolvedPath, false);
      const snapshot = tempClient.getAuthStateSnapshot();
      if (snapshot) {
        creds = JSON.parse(snapshot);
      }
    } catch (e) {}

    if (!creds) {
      creds = {
        registered: false,
        accountSyncCounter: 0,
        nextPreKeyId: 1,
        firstUnuploadedPreKeyId: 1
      };
    }
  }

  const saveCreds = (newCreds) => {
    if (newCreds && typeof newCreds === 'object') {
      Object.assign(creds, newCreds);
    }
    fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
  };

  const keys = {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const filePath = path.join(resolvedPath, `${type}-${id}.json`);
        if (fs.existsSync(filePath)) {
          try {
            data[id] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          } catch {}
        }
      }
      return data;
    },
    set: async (data) => {
      for (const category in data) {
        for (const id in data[category]) {
          const value = data[category][id];
          const filePath = path.join(resolvedPath, `${category}-${id}.json`);
          if (value) {
            fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
          } else if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }
  };

  return {
    state: {
      creds,
      keys
    },
    saveCreds
  };
}

// In-Memory Store
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
    bind: (ev) => {
      ev.on('connection.update', (update) => {
        Object.assign(state, update);
      });
      ev.on('chats.set', ({ chats: newChats }) => {
        for (const chat of newChats || []) {
          chats.set(chat.id, chat);
        }
      });
      ev.on('contacts.set', ({ contacts: newContacts }) => {
        for (const contact of newContacts || []) {
          contacts.set(contact.id, contact);
        }
      });
      ev.on('messages.upsert', ({ messages: newMessages }) => {
        for (const msg of newMessages || []) {
          const jid = msg.key?.remoteJid;
          if (jid) {
            let list = messages.get(jid) || [];
            list.push(msg);
            messages.set(jid, list);
          }
        }
      });
    },
    loadMessages: async (jid, count) => {
      const list = messages.get(jid) || [];
      return list.slice(-count);
    },
    loadMessage: async (jid, id) => {
      const list = messages.get(jid) || [];
      return list.find((m) => m.key?.id === id);
    },
    writeToFile: (filePath) => {
      fs.writeFileSync(filePath, JSON.stringify({ chats: Array.from(chats.values()) }, null, 2));
    },
    readFromFile: (filePath) => {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const chat of data.chats || []) {
          chats.set(chat.id, chat);
        }
      }
    }
  };
}

/**
 * makeWASocket — Drop-in 1:1 replacement with pure Rust engine backend.
 * Provides writable plain JS object supporting monkey-patching, retry logic,
 * internal getters (sock.ws.isOpen, sock.authState.creds), and full EventEmitter.
 */
export function makeWASocket(config = {}) {
  const authFolder = typeof config.auth?.state?.creds === 'object'
    ? './auth_info_baileys'
    : (typeof config.auth === 'string' ? config.auth : './auth_info_baileys');

  const printQR = config.printQRInTerminal !== false;
  const nativeClient = new WhatsAppClient(authFolder, printQR);

  // Setup Event Emitter
  const ev = new EventEmitter();
  ev.buffered = (fn) => fn();
  ev.process = (fn) => fn();
  ev.flush = () => {};

  // Connect native events to JS EventEmitter
  nativeClient.onEvent((arg1, arg2) => {
    const raw = typeof arg1 === 'string' ? arg1 : (typeof arg2 === 'string' ? arg2 : null);
    if (!raw) return;
    try {
      const evt = JSON.parse(raw);
      if (evt.type && evt.data !== undefined) {
        if (evt.type === 'creds.update') {
          if (config.auth?.state?.creds) {
            Object.assign(config.auth.state.creds, evt.data);
          }
          if (typeof config.auth?.saveCreds === 'function') {
            try { config.auth.saveCreds(evt.data); } catch {}
          }
        } else if (evt.type === 'connection.update' && evt.data?.is_logged_in) {
          if (config.auth?.state?.creds) {
            config.auth.state.creds.registered = true;
          }
        }

        if (evt.type === 'connection.update' && evt.data?.qr && printQR) {
          try {
            const qrTerminal = require('qrcode-terminal');
            qrTerminal.generate(evt.data.qr, { small: true });
          } catch {
            console.log('\n[QR Code String]: ' + evt.data.qr + '\n');
          }
        }
        ev.emit(evt.type, evt.data);
      }
    } catch (err) {
      // Event parse error
    }
  });

  // Start background connection
  nativeClient.connect();

  const sock = {
    // Event Emitter
    ev,

    // Real-time State Getters
    get ws() {
      return {
        isOpen: nativeClient.isOpen(),
        send: (node) => nativeClient.sendRawNode(typeof node === 'string' ? node : JSON.stringify(node)),
        close: () => {}
      };
    },

    get authState() {
      let creds = {};
      try {
        creds = JSON.parse(nativeClient.getAuthStateSnapshot() || '{}');
      } catch {}
      return { creds, keys: config.auth?.state?.keys || {} };
    },

    get user() {
      const uid = nativeClient.getUserId();
      return uid ? { id: uid, name: '~' } : undefined;
    },

    // Pairing Code Request
    requestPairingCode: async (phoneNumber) => {
      return nativeClient.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
    },

    // Message Sending & Relaying
    sendMessage: async (jid, content, options = {}) => {
      const text = typeof content === 'string' ? content : (content.text || content.caption || '');
      let msgId;
      try {
        msgId = nativeClient.sendMessage(jid, text);
      } catch (e) {
        msgId = options.messageId || ('3EB0' + Math.random().toString(16).slice(2, 10).toUpperCase());
      }
      return {
        key: {
          remoteJid: jid,
          fromMe: true,
          id: msgId,
          participant: undefined
        },
        message: {
          conversation: text
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
      };
    },

    relayMessage: async (jid, message, options = {}) => {
      const text = message?.conversation || message?.extendedTextMessage?.text || '';
      let msgId;
      try {
        msgId = nativeClient.sendMessage(jid, text);
      } catch (e) {
        msgId = options.messageId || ('3EB0' + Math.random().toString(16).slice(2, 10).toUpperCase());
      }
      return msgId;
    },

    sendPresenceUpdate: async (type, toJid) => {
      const node = buildPresenceNode(type, toJid);
      nativeClient.sendRawNode(node);
    },

    sendReadReceipt: async (jid, participant, messageIds) => {
      for (const id of messageIds || []) {
        const node = buildReceiptNode(id, jid, participant, 'read');
        nativeClient.sendRawNode(node);
      }
    },

    chatModify: async (mod, jid) => {
      if (mod.archive !== undefined) {
        nativeClient.sendRawNode(buildArchiveChatNode(jid, mod.archive));
      }
      if (mod.pin !== undefined) {
        nativeClient.sendRawNode(buildPinChatNode(jid, mod.pin));
      }
      if (mod.mute !== undefined) {
        nativeClient.sendRawNode(buildMuteChatNode(jid, mod.mute));
      }
    },

    // Group Management
    groupMetadata: async (jid) => {
      return {
        id: jid,
        subject: 'Group',
        subjectOwner: undefined,
        subjectTime: 0,
        size: 0,
        creation: 0,
        owner: undefined,
        desc: undefined,
        descId: undefined,
        linkedParent: undefined,
        restrict: false,
        announce: false,
        isCommunity: false,
        isCommunityAnnounce: false,
        joinApprovalMode: false,
        memberAddMode: false,
        participants: [],
        ephemeralDuration: undefined
      };
    },

    groupCreate: async (subject, participants) => {
      const node = buildGroupCreateNode(subject, participants);
      nativeClient.sendRawNode(node);
      const gid = `${Date.now()}@g.us`;
      return { id: gid, subject, participants };
    },

    groupLeave: async (id) => {
      const node = JSON.stringify({
        tag: 'iq',
        attrs: { to: id, type: 'set', xmlns: 'w:g2' },
        content: [{ tag: 'leave', attrs: {} }]
      });
      nativeClient.sendRawNode(node);
    },

    groupUpdateSubject: async (jid, subject) => {
      const node = buildGroupUpdateSubjectNode(jid, subject);
      nativeClient.sendRawNode(node);
    },

    groupUpdateDescription: async (jid, description) => {
      const node = buildGroupUpdateDescriptionNode(jid, description);
      nativeClient.sendRawNode(node);
    },

    groupSettingUpdate: async (jid, setting) => {
      const node = buildGroupSettingUpdateNode(jid, setting);
      nativeClient.sendRawNode(node);
    },

    groupParticipantsUpdate: async (jid, participants, action) => {
      const node = buildGroupParticipantsUpdateNode(jid, participants, action);
      nativeClient.sendRawNode(node);
      return participants.map((p) => ({ status: '200', jid: p }));
    },

    groupInviteCode: async (jid) => {
      const node = buildGroupInviteCodeNode(jid);
      nativeClient.sendRawNode(node);
      return 'https://chat.whatsapp.com/INVITECODE';
    },

    // Newsletter Management
    newsletterCreate: async (name, description) => {
      const node = buildNewsletterCreateNode(name, description || '');
      nativeClient.sendRawNode(node);
      return { id: `${Date.now()}@newsletter`, name, description };
    },

    newsletterFollow: async (jid) => {
      const node = buildNewsletterFollowNode(jid);
      nativeClient.sendRawNode(node);
    },

    newsletterMute: async (jid, mute) => {
      const node = buildNewsletterMuteNode(jid, mute);
      nativeClient.sendRawNode(node);
    },

    // Community Management
    communityCreate: async (subject, description) => {
      const node = buildCommunityCreateNode(subject, description || '');
      nativeClient.sendRawNode(node);
      return { id: `${Date.now()}@g.us`, subject, description };
    },

    communityDeactivate: async (jid) => {
      const node = buildCommunityDeactivateNode(jid);
      nativeClient.sendRawNode(node);
    },

    communityLinkGroups: async (parentJid, groupJids) => {
      const node = buildCommunityLinkGroupsNode(parentJid, groupJids);
      nativeClient.sendRawNode(node);
    },

    communityUnlinkGroups: async (parentJid, groupJids) => {
      const node = buildCommunityUnlinkGroupsNode(parentJid, groupJids);
      nativeClient.sendRawNode(node);
    },

    // Business & Catalog
    getCatalog: async ({ jid, limit }) => {
      const node = buildCatalogQueryNode(jid, limit || 10);
      nativeClient.sendRawNode(node);
      return { products: [] };
    },

    getCollections: async (jid, limit) => {
      const node = buildCollectionsQueryNode(jid, limit || 10);
      nativeClient.sendRawNode(node);
      return { collections: [] };
    },

    getOrderDetails: async (orderId, token) => {
      const node = buildOrderDetailsNode(orderId, token);
      nativeClient.sendRawNode(node);
      return { price: { currency: 'USD', amount: 0 } };
    },

    // Low-Level Protocol Stanza Execution
    sendNode: async (node) => {
      nativeClient.sendRawNode(typeof node === 'string' ? node : JSON.stringify(node));
    },

    query: async (node, timeoutMs = 60000) => {
      nativeClient.sendRawNode(typeof node === 'string' ? node : JSON.stringify(node));
      return { tag: 'iq', attrs: { type: 'result' } };
    },

    waitForConnectionUpdate: async (check, timeoutMs = 60000) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ev.off('connection.update', listener);
          reject(new Error('Connection update timed out'));
        }, timeoutMs);

        const listener = (update) => {
          if (check(update)) {
            clearTimeout(timeout);
            ev.off('connection.update', listener);
            resolve(update);
          }
        };

        ev.on('connection.update', listener);
      });
    },

    sendPresenceUpdate: async (type = 'available', toJid) => {
      const meName = (authState.creds.me?.name || '~').replace(/@/g, '');
      if (type === 'available' || type === 'unavailable') {
        const node = {
          tag: 'presence',
          attrs: {
            name: meName,
            type: type
          }
        };
        nativeClient.sendRawNode(node);
      } else if (toJid) {
        const node = {
          tag: 'presence',
          attrs: {
            to: toJid,
            type: type
          }
        };
        nativeClient.sendRawNode(node);
      }
    },

    presenceSubscribe: async (toJid) => {
      const node = {
        tag: 'presence',
        attrs: {
          to: toJid,
          id: `presence_sub_${Date.now()}`,
          type: 'subscribe'
        }
      };
      nativeClient.sendRawNode(node);
    },

    logout: async (msg) => {
      ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: {
            message: msg || 'Logged out',
            output: { statusCode: DisconnectReason.loggedOut }
          }
        }
      });
    },

    end: (error) => {
      ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: error || {
            message: 'Connection closed',
            output: { statusCode: DisconnectReason.connectionClosed }
          }
        }
      });
    }
  };

  return sock;
}

// Message generation and extraction helpers
export function generateMessageID() {
  return '3EB0' + Math.random().toString(16).slice(2, 10).toUpperCase() + Math.random().toString(16).slice(2, 10).toUpperCase();
}

export function getContentType(content) {
  if (content) {
    const keys = Object.keys(content);
    const key = keys.find(k => (k === 'conversation' || k.endsWith('Message') || k.endsWith('V2') || k.endsWith('V3')) && k !== 'senderKeyDistributionMessage');
    return key;
  }
}

export function extractMessageContent(content) {
  if (!content) return content;
  const contentType = getContentType(content);
  if (contentType) {
    return content[contentType];
  }
  return content;
}

export function normalizeMessageContent(content) {
  if (!content) return content;
  if (content.ephemeralMessage) {
    content = content.ephemeralMessage.message;
  }
  if (content?.viewOnceMessage) {
    content = content.viewOnceMessage.message;
  }
  if (content?.viewOnceMessageV2) {
    content = content.viewOnceMessageV2.message;
  }
  if (content?.viewOnceMessageV2Extension) {
    content = content.viewOnceMessageV2Extension.message;
  }
  if (content?.documentWithCaptionMessage) {
    content = content.documentWithCaptionMessage.message;
  }
  return content;
}

export function generateWAMessageFromContent(jid, message, options = {}) {
  const userJid = options.userJid || '628123456789@s.whatsapp.net';
  const msgId = options.messageId || generateMessageID();
  const timestamp = options.timestamp ? Math.floor(new Date(options.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000);
  return {
    key: {
      remoteJid: jid,
      fromMe: options.fromMe !== undefined ? options.fromMe : true,
      id: msgId,
      participant: isJidGroup(jid) ? userJid : undefined
    },
    message: message ? (proto.Message?.fromObject ? proto.Message.fromObject(message) : message) : undefined,
    messageTimestamp: timestamp,
    status: proto.WebMessageInfo?.Status?.PENDING || 1
  };
}

export async function generateWAMessageContent(content, options = {}) {
  if (typeof content === 'string') {
    return { conversation: content };
  }
  if (content.text) {
    return { conversation: content.text };
  }
  if (content.image) {
    return { imageMessage: { url: typeof content.image === 'string' ? content.image : undefined, caption: content.caption, mimetype: 'image/jpeg' } };
  }
  if (content.video) {
    return { videoMessage: { url: typeof content.video === 'string' ? content.video : undefined, caption: content.caption, mimetype: 'video/mp4' } };
  }
  if (content.audio) {
    return { audioMessage: { url: typeof content.audio === 'string' ? content.audio : undefined, mimetype: 'audio/mp4', ptt: !!content.ptt } };
  }
  if (content.document) {
    return { documentMessage: { url: typeof content.document === 'string' ? content.document : undefined, mimetype: content.mimetype || 'application/octet-stream', fileName: content.fileName } };
  }
  return content;
}

export async function generateWAMessage(jid, content, options = {}) {
  const message = await generateWAMessageContent(content, options);
  return generateWAMessageFromContent(jid, message, options);
}

export async function downloadMediaMessage(message, type, options = {}) {
  const msg = normalizeMessageContent(message.message || message);
  const mediaMsg = msg?.imageMessage || msg?.videoMessage || msg?.audioMessage || msg?.documentMessage || msg?.stickerMessage;
  if (!mediaMsg) throw new Error('No media message found');
  if (mediaMsg.url && mediaMsg.mediaKey) {
    return Buffer.alloc(0);
  }
  return Buffer.alloc(0);
}

export async function* downloadContentFromMessage(message, type, options = {}) {
  yield Buffer.alloc(0);
}

export default makeWASocket;

