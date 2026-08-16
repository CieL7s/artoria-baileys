import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Re-export everything from official complete Baileys library
export * from './lib/index.js';
import makeWASocket from './lib/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load native pure-Rust compiled NAPI module if available
let native = null;
const possiblePaths = [
  path.join(__dirname, 'rust/target/release/baileys_napi.dll'),
  path.join(__dirname, 'baileys-napi.win32-x64-msvc.node'),
  path.join(__dirname, 'baileys_napi.node'),
  path.join(__dirname, 'baileys-napi.node'),
  './baileys-napi.win32-x64-msvc.node',
  './baileys_napi.node',
  './baileys-napi.node'
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

// Export native Rust high-performance bindings
export const nativeRust = native;
export const version = native?.version;
export const decryptMedia = native?.decryptMedia;
export const encryptMedia = native?.encryptMedia;
export const buildPingNode = native?.buildPingNode;
export const buildSyncdNode = native?.buildSyncdNode;
export const encodeWamEvent = native?.encodeWamEvent;
export const computePatchMac = native?.computePatchMac;
export const decodeBinaryNode = native?.decodeBinaryNode;
export const encodeBinaryNode = native?.encodeBinaryNode;
export const buildReceiptNode = native?.buildReceiptNode;
export const buildPinChatNode = native?.buildPinChatNode;
export const buildPresenceNode = native?.buildPresenceNode;
export const buildMuteChatNode = native?.buildMuteChatNode;
export const buildGroupCreateNode = native?.buildGroupCreateNode;
export const buildUsyncQueryNode = native?.buildUsyncQueryNode;
export const buildUSyncQueryNode = native?.buildUsyncQueryNode;
export const buildArchiveChatNode = native?.buildArchiveChatNode;
export const buildCatalogQueryNode = native?.buildCatalogQueryNode;
export const buildOrderDetailsNode = native?.buildOrderDetailsNode;
export const buildProductQueryNode = native?.buildProductQueryNode;
export const buildNewsletterMuteNode = native?.buildNewsletterMuteNode;
export const buildCommunityCreateNode = native?.buildCommunityCreateNode;
export const buildCollectionsQueryNode = native?.buildCollectionsQueryNode;
export const buildGroupInviteCodeNode = native?.buildGroupInviteCodeNode;
export const buildNewsletterCreateNode = native?.buildNewsletterCreateNode;
export const buildNewsletterFollowNode = native?.buildNewsletterFollowNode;
export const buildCommunityDeactivateNode = native?.buildCommunityDeactivateNode;
export const buildGroupSettingUpdateNode = native?.buildGroupSettingUpdateNode;
export const buildGroupUpdateSubjectNode = native?.buildGroupUpdateSubjectNode;
export const buildCommunityLinkGroupsNode = native?.buildCommunityLinkGroupsNode;
export const buildCommunityUnlinkGroupsNode = native?.buildCommunityUnlinkGroupsNode;
export const buildGroupUpdateDescriptionNode = native?.buildGroupUpdateDescriptionNode;
export const buildGroupParticipantsUpdateNode = native?.buildGroupParticipantsUpdateNode;
export const WhatsAppClient = native?.WhatsAppClient;
export const NoiseTransport = native?.NoiseTransport;
export const usyncBuildQuery = native?.usyncBuildQuery;
export const usyncParseQueryResult = native?.usyncParseQueryResult;
export const makeInMemoryStore = (config) => ({
  chats: new Map(),
  messages: new Map(),
  contacts: new Map(),
  bind: (ev) => {},
  writeToFile: () => {},
  readFromFile: () => {}
});

export { makeWASocket };
export default makeWASocket;
