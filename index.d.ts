import { EventEmitter } from 'events';

export interface FullJid {
  user: string;
  server: string;
  device?: number;
  agent?: number;
  domainType?: number;
}

export interface BinaryNode {
  tag: string;
  attrs: Record<string, string>;
  content?: string | BinaryNode[] | Buffer;
}

export interface EncryptedMedia {
  encryptedBuffer: Buffer;
  mediaKey: Buffer;
  fileSha256: Buffer;
  fileEncSha256: Buffer;
}

export interface NodePayload {
  id: string;
  node_json: string;
}

export interface ConnectionStateUpdate {
  connection: string;
  qr?: string;
  isLoggedIn: boolean;
}

export interface MessagesUpsertEvent {
  messages: any[];
  type: string;
}

export interface BaileysEventEmitter extends EventEmitter {
  on(event: 'connection.update', listener: (update: ConnectionStateUpdate) => void): this;
  on(event: 'messages.upsert', listener: (upsert: MessagesUpsertEvent) => void): this;
  on(event: 'creds.update', listener: (creds: any) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface AurielWASocket {
  ev: BaileysEventEmitter;
  native: any;
  authState: any;
  user: { id: string; name?: string };
  ws: { isOpen: boolean; send(data: any): void; close(): void };
  connect(): void;
  requestPairingCode(phoneNumber: string): Promise<string>;
  updateMediaMessage(msg: any): Promise<any>;
  decodeJid(jid: string): string;
  relayMessage(jid: string, message: any, options?: any): Promise<string>;
  sendMessage(jid: string, content: any, options?: any): Promise<any>;
  sendPresenceUpdate(type: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused', toJid?: string): Promise<void>;
  sendReadReceipt(jid: string, participant: string | null, messageIds: (string | { id?: string; key?: { id?: string } })[], type?: string): Promise<void>;
  readMessages(keys: Array<{ id: string; remoteJid: string; participant?: string }>): Promise<void>;
  groupCreate(subject: string, participants: string[]): Promise<string>;
  groupParticipantsUpdate(jid: string, participants: string[], action: 'add' | 'remove' | 'promote' | 'demote'): Promise<string>;
  groupInviteCode(jid: string): Promise<string>;
  groupUpdateSubject(jid: string, subject: string): Promise<string>;
  groupUpdateDescription(jid: string, description: string): Promise<string>;
  groupSettingUpdate(jid: string, setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked'): Promise<string>;
  groupMetadata(jid: string): Promise<any>;
  groupFetchAllParticipating(): Promise<Record<string, any>>;
  onWhatsApp(...jids: string[]): Promise<Array<{ jid: string; exists: boolean }>>;
  profilePictureUrl(jid: string, type?: string): Promise<string | null>;
  chatModify(modification: { mute?: number; pin?: boolean; archive?: boolean }, jid: string): Promise<string | undefined>;
  newsletterCreate(name: string, description: string): Promise<string>;
  newsletterFollow(jid: string): Promise<string>;
  newsletterMute(jid: string, mute?: boolean): Promise<string>;
  communityCreate(subject: string, description: string): Promise<string>;
  communityDeactivate(communityJid: string): Promise<string>;
  communityLinkGroups(communityJid: string, groupJids: string[]): Promise<string>;
  communityUnlinkGroups(communityJid: string, groupJids: string[]): Promise<string>;
  getCatalog(jid: string, limit?: number): Promise<string>;
  getProduct(jid: string, productId: string): Promise<string>;
  getCollections(jid: string): Promise<string>;
  getOrderDetails(orderId: string, token: string): Promise<string>;
  executeUSyncQuery(users: string[], protocols: string[], mode?: 'interactive' | 'background', context?: string): Promise<string>;
  resyncAppState(collection: string, version: number, patchMac: Buffer, mutations?: any[]): Promise<string>;
  computePatchMac(patchData: Buffer, key: Buffer, version: number): Buffer;
  encodeWam(eventId: number, attributes: Record<string, any>): Buffer;
  decryptMedia(encryptedBuffer: Buffer, mediaKey: Buffer, mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker'): Buffer;
  encryptMedia(plaintextBuffer: Buffer, mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker'): EncryptedMedia;
  [key: string]: any;
}

export class NoiseTransport {
  constructor(encKey: Buffer, decKey: Buffer);
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
  getReadCounter(): number;
  getWriteCounter(): number;
}

export class WhatsAppClient {
  constructor(authFolder?: string);
  onEvent(callback: (eventJson: string) => void): void;
  connect(): void;
  sendMessage(toJid: string, text: string): string;
  sendRawNode(nodeJson: string): void;
}

export const DisconnectReason: {
  connectionClosed: number;
  connectionLost: number;
  connectionReplaced: number;
  timedOut: number;
  loggedOut: number;
  badSession: number;
  restartRequired: number;
  multideviceMismatch: number;
};

export const Browsers: {
  ubuntu(browser: string): [string, string, string];
  macOS(browser: string): [string, string, string];
  baileys(browser: string): [string, string, string];
  windows(browser: string): [string, string, string];
  appropriate(browser: string): [string, string, string];
};

export const DEFAULT_CONNECTION_CONFIG: Record<string, any>;
export const WA_DEFAULT_EPHEMERAL: number;
export const PROCESSABLE_HISTORY_TYPES: number[];
export const UNAUTHORIZED_CODES: number[];
export const DEFAULT_ORIGIN: string;

export function fetchLatestBaileysVersion(): Promise<{ version: number[]; isLatest: boolean }>;
export function useMultiFileAuthState(folder: string): Promise<{ state: any; saveCreds: () => Promise<void> }>;
export function makeCacheableSignalKeyStore(store: any, logger?: any): any;
export function makeInMemoryStore(config?: any): any;

export function jidEncode(user: string, server: string, device?: number, agent?: number): string;
export function jidDecode(jid: string): FullJid | null;
export function jidNormalizedUser(jid: string): string;
export function decodeBinaryNode(buffer: Buffer): string;
export function encodeBinaryNode(nodeJson: string): Buffer;
export function encryptMedia(plaintext: Buffer, mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker'): EncryptedMedia;
export function decryptMedia(encryptedBuffer: Buffer, mediaKey: Buffer, mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker'): Buffer;
export function version(): string;

export function buildGroupCreateNode(subject: string, participants: string[]): NodePayload;
export function buildGroupParticipantsUpdateNode(jid: string, participants: string[], action: string): NodePayload;
export function buildGroupInviteCodeNode(jid: string): NodePayload;
export function buildGroupUpdateSubjectNode(jid: string, subject: string): NodePayload;
export function buildGroupUpdateDescriptionNode(jid: string, description: string): NodePayload;
export function buildGroupSettingUpdateNode(jid: string, setting: string): NodePayload;
export function buildMuteChatNode(jid: string, durationSeconds?: number | null): NodePayload;
export function buildPinChatNode(jid: string, pin: boolean): NodePayload;
export function buildArchiveChatNode(jid: string, archive: boolean): NodePayload;
export function buildNewsletterCreateNode(name: string, description: string): NodePayload;
export function buildNewsletterFollowNode(jid: string): NodePayload;
export function buildNewsletterMuteNode(jid: string, mute?: boolean): NodePayload;
export function buildCommunityCreateNode(subject: string, description: string): NodePayload;
export function buildCommunityDeactivateNode(communityJid: string): NodePayload;
export function buildCommunityLinkGroupsNode(communityJid: string, groupJids: string[]): NodePayload;
export function buildCommunityUnlinkGroupsNode(communityJid: string, groupJids: string[]): NodePayload;
export function buildCatalogQueryNode(jid: string, limit?: number): NodePayload;
export function buildProductQueryNode(jid: string, productId: string): NodePayload;
export function buildCollectionsQueryNode(jid: string): NodePayload;
export function buildOrderDetailsNode(orderId: string, token: string): NodePayload;
export function buildUSyncQueryNode(users: string[], protocols: string[], mode?: string, context?: string): NodePayload;
export function computePatchMac(patchData: Buffer, key: Buffer, version: number): Buffer;
export function buildSyncdNode(collection: string, version: number, patchMac: Buffer, mutations?: any[]): NodePayload;
export function encodeWamEvent(eventId: number, attributes: Record<string, any>): Buffer;
export function buildReceiptNode(jid: string, participant: string | null, messageIds: string[], receiptType?: string): NodePayload;
export function buildPresenceNode(presenceType: string, toJid?: string | null): NodePayload;
export function buildPingNode(): NodePayload;

export function isJidGroup(jid: string): boolean;
export function isJidUser(jid: string): boolean;
export function isJidStatusBroadcast(jid: string): boolean;
export function isJidNewsletter(jid: string): boolean;
export function areJidsSameUser(jid1: string, jid2: string): boolean;
export function generateMessageID(): string;
export function getContentType(content: any): string | undefined;
export function extractMessageContent(content: any): any;
export function generateWAMessageFromContent(jid: string, message: any, options?: any): any;
export function generateWAMessageContent(content: any, options?: any): any;
export function generateWAMessage(jid: string, content: any, options?: any): any;
export function downloadMediaMessage(msg: any, type?: string, options?: any, ctx?: any): Promise<Buffer>;

export const proto: any;

export function makeWASocket(config?: { auth?: any; authFolder?: string; [key: string]: any }): AurielWASocket;
export default makeWASocket;
