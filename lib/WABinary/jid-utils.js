// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./jid-utils.legacy.js
import { nativeRust as rust } from '../Utils/native-loader.js';

export const S_WHATSAPP_NET = '@s.whatsapp.net';
export const OFFICIAL_BIZ_JID = '16505361212@c.us';
export const SERVER_JID = 'server@c.us';
export const PSA_WID = '0@c.us';
export const STORIES_JID = 'status@broadcast';
export const META_AI_JID = '13135550002@c.us';
export var WAJIDDomains;
(function (WAJIDDomains) {
    WAJIDDomains[WAJIDDomains["WHATSAPP"] = 0] = "WHATSAPP";
    WAJIDDomains[WAJIDDomains["LID"] = 1] = "LID";
    WAJIDDomains[WAJIDDomains["HOSTED"] = 128] = "HOSTED";
    WAJIDDomains[WAJIDDomains["HOSTED_LID"] = 129] = "HOSTED_LID";
})(WAJIDDomains || (WAJIDDomains = {}));

export const getServerFromDomainType = (initialServer, domainType) => {
    switch (domainType) {
        case WAJIDDomains.LID:
            return 'lid';
        case WAJIDDomains.HOSTED:
            return 'hosted';
        case WAJIDDomains.HOSTED_LID:
            return 'hosted.lid';
        case WAJIDDomains.WHATSAPP:
        default:
            return initialServer;
    }
};

export const jidEncode = (user, server, device, agent) => {
    if (!server) return '';
    let prefix = user || '';
    if (typeof agent === 'number') {
        prefix += `_${agent}`;
    }
    if (typeof device === 'number') {
        prefix += `:${device}`;
    }
    return `${prefix}@${server}`;
};

export const jidDecode = (jid) => {
    if (typeof jid !== 'string') return undefined;
    const sepIdx = jid.indexOf('@');
    if (sepIdx < 0) return undefined;
    const server = jid.slice(sepIdx + 1);
    const userCombined = jid.slice(0, sepIdx);
    
    let domainType = WAJIDDomains.WHATSAPP;
    if (server === 'lid') {
        domainType = WAJIDDomains.LID;
    } else if (server === 'hosted') {
        domainType = WAJIDDomains.HOSTED;
    } else if (server === 'hosted.lid') {
        domainType = WAJIDDomains.HOSTED_LID;
    }
    
    const colonIdx = userCombined.indexOf(':');
    let user = userCombined;
    let device;
    if (colonIdx >= 0) {
        user = userCombined.slice(0, colonIdx);
        device = parseInt(userCombined.slice(colonIdx + 1), 10);
        if (Number.isNaN(device)) device = undefined;
    }
    
    const underscoreIdx = user.indexOf('_');
    let agent;
    if (underscoreIdx >= 0) {
        agent = parseInt(user.slice(underscoreIdx + 1), 10);
        if (Number.isNaN(agent)) agent = undefined;
        user = user.slice(0, underscoreIdx);
    }
    
    return {
        server,
        user,
        domainType,
        device,
        agent
    };
};

/** is the jid a user */
export const areJidsSameUser = (jid1, jid2) => {
    if (jid1 === jid2) return true;
    return jidDecode(jid1)?.user === jidDecode(jid2)?.user;
};
/** is the jid Meta AI */
export const isJidMetaAI = (jid) => typeof jid === 'string' && jid.endsWith('@bot');
/** is the jid a PN user */
export const isPnUser = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
export const isJidUser = (jid) => isPnUser(jid);
/** is the jid a LID */
export const isLidUser = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
/** is the jid a broadcast */
export const isJidBroadcast = (jid) => typeof jid === 'string' && jid.endsWith('@broadcast');
/** is the jid a group */
export const isJidGroup = (jid) => typeof jid === 'string' && jid.endsWith('@g.us');
/** is the jid the status broadcast */
export const isJidStatusBroadcast = (jid) => jid === 'status@broadcast';
/** is the jid a newsletter */
export const isJidNewsletter = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter');
/** is the jid a hosted PN */
export const isHostedPnUser = (jid) => typeof jid === 'string' && jid.endsWith('@hosted');
/** is the jid a hosted LID */
export const isHostedLidUser = (jid) => typeof jid === 'string' && jid.endsWith('@hosted.lid');
const botRegexp = /^1313555\d{4}$|^131655500\d{2}$/;
export const isJidBot = (jid) => typeof jid === 'string' && botRegexp.test(jid.split('@')[0]) && jid.endsWith('@c.us');

export const jidNormalizedUser = (jid) => {
    if (typeof jid !== 'string' || !jid) return '';
    const decoded = jidDecode(jid);
    if (!decoded) return '';
    return jidEncode(decoded.user, decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server);
};

export const transferDevice = (fromJid, toJid) => {
    const fromDecoded = jidDecode(fromJid);
    const deviceId = fromDecoded?.device || 0;
    const { server, user } = jidDecode(toJid) || {};
    return jidEncode(user, server, deviceId);
};
//# sourceMappingURL=jid-utils.js.map