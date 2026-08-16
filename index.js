import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Re-export everything from official complete Baileys library
export * from './lib/index.js';
import makeWASocket from './lib/index.js';
import { nativeRust } from './lib/Utils/native-loader.js';

// Export native Rust high-performance bindings
export const nativeRustBinding = nativeRust;
export { nativeRust };
export const version = nativeRust?.version;
export const decryptMedia = nativeRust?.decryptMedia;
export const encryptMedia = nativeRust?.encryptMedia;
export const buildPingNode = nativeRust?.buildPingNode;
export const buildSyncdNode = nativeRust?.buildSyncdNode;
export const encodeWamEvent = nativeRust?.encodeWamEvent;
export const computePatchMac = nativeRust?.computePatchMac;
export const decodeBinaryNode = nativeRust?.decodeBinaryNode;
export const encodeBinaryNode = nativeRust?.encodeBinaryNode;
export const buildReceiptNode = nativeRust?.buildReceiptNode;
export const buildPinChatNode = nativeRust?.buildPinChatNode;
export const buildPresenceNode = nativeRust?.buildPresenceNode;
export const buildMuteChatNode = nativeRust?.buildMuteChatNode;
export const buildGroupCreateNode = nativeRust?.buildGroupCreateNode;
export const buildUsyncQueryNode = nativeRust?.buildUsyncQueryNode;
export const buildUSyncQueryNode = nativeRust?.buildUsyncQueryNode;
export const buildArchiveChatNode = nativeRust?.buildArchiveChatNode;
export const buildCatalogQueryNode = nativeRust?.buildCatalogQueryNode;
export const buildOrderDetailsNode = nativeRust?.buildOrderDetailsNode;
export const buildProductQueryNode = nativeRust?.buildProductQueryNode;
export const buildNewsletterMuteNode = nativeRust?.buildNewsletterMuteNode;
export const buildCommunityCreateNode = nativeRust?.buildCommunityCreateNode;
export const buildCollectionsQueryNode = nativeRust?.buildCollectionsQueryNode;
export const buildGroupInviteCodeNode = nativeRust?.buildGroupInviteCodeNode;
export const buildNewsletterCreateNode = nativeRust?.buildNewsletterCreateNode;
export const buildNewsletterFollowNode = nativeRust?.buildNewsletterFollowNode;
export const buildCommunityDeactivateNode = nativeRust?.buildCommunityDeactivateNode;
export const buildGroupSettingUpdateNode = nativeRust?.buildGroupSettingUpdateNode;
export const buildGroupUpdateSubjectNode = nativeRust?.buildGroupUpdateSubjectNode;
export const buildCommunityLinkGroupsNode = nativeRust?.buildCommunityLinkGroupsNode;
export const buildCommunityUnlinkGroupsNode = nativeRust?.buildCommunityUnlinkGroupsNode;
export const buildGroupUpdateDescriptionNode = nativeRust?.buildGroupUpdateDescriptionNode;
export const buildGroupParticipantsUpdateNode = nativeRust?.buildGroupParticipantsUpdateNode;
export const WhatsAppClient = nativeRust?.WhatsAppClient;
export const NoiseTransport = nativeRust?.NoiseTransport;
export const usyncBuildQuery = nativeRust?.usyncBuildQuery;
export const usyncParseQueryResult = nativeRust?.usyncParseQueryResult;
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
