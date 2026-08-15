// [RUST-DELEGATED] This file is a thin N-API bridge. Original JS logic archived at ./jid-utils.legacy.js
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));

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
    return rust.jidEncode(user || '', server, typeof device === 'number' ? device : undefined, typeof agent === 'number' ? agent : undefined);
};

export const jidDecode = (jid) => {
    if (typeof jid !== 'string') return undefined;
    const res = rust.jidDecode(jid);
    if (!res) return undefined;
    return {
        server: res.server,
        user: res.user,
        domainType: typeof res.domainType === 'number' ? res.domainType : WAJIDDomains.WHATSAPP,
        device: typeof res.device === 'number' ? res.device : undefined
    };
};

/** is the jid a user */
export const areJidsSameUser = (jid1, jid2) => jidDecode(jid1)?.user === jidDecode(jid2)?.user;
/** is the jid Meta AI */
export const isJidMetaAI = (jid) => jid?.endsWith('@bot');
/** is the jid a PN user */
export const isPnUser = (jid) => jid?.endsWith('@s.whatsapp.net');
/** is the jid a LID */
export const isLidUser = (jid) => jid?.endsWith('@lid');
/** is the jid a broadcast */
export const isJidBroadcast = (jid) => jid?.endsWith('@broadcast');
/** is the jid a group */
export const isJidGroup = (jid) => jid?.endsWith('@g.us');
/** is the jid the status broadcast */
export const isJidStatusBroadcast = (jid) => jid === 'status@broadcast';
/** is the jid a newsletter */
export const isJidNewsletter = (jid) => jid?.endsWith('@newsletter');
/** is the jid a hosted PN */
export const isHostedPnUser = (jid) => jid?.endsWith('@hosted');
/** is the jid a hosted LID */
export const isHostedLidUser = (jid) => jid?.endsWith('@hosted.lid');
const botRegexp = /^1313555\d{4}$|^131655500\d{2}$/;
export const isJidBot = (jid) => jid && botRegexp.test(jid.split('@')[0]) && jid.endsWith('@c.us');

export const jidNormalizedUser = (jid) => {
    if (typeof jid !== 'string' || !jid) return '';
    return rust.jidNormalizedUser(jid);
};

export const transferDevice = (fromJid, toJid) => {
    const fromDecoded = jidDecode(fromJid);
    const deviceId = fromDecoded?.device || 0;
    const { server, user } = jidDecode(toJid) || {};
    return jidEncode(user, server, deviceId);
};
//# sourceMappingURL=jid-utils.js.map