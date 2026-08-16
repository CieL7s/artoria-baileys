import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBinaryNodeChild } from '../WABinary/index.js';
import { USyncBotProfileProtocol } from './Protocols/UsyncBotProfileProtocol.js';
import { USyncLIDProtocol } from './Protocols/UsyncLIDProtocol.js';
import { USyncContactProtocol, USyncDeviceProtocol, USyncDisappearingModeProtocol, USyncStatusProtocol, USyncUsernameProtocol } from './Protocols/index.js';
import { USyncUser } from './USyncUser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let rust = null;
try {
    rust = require(path.join(__dirname, '../../baileys-napi.node'));
} catch (e) {
    rust = null;
}

const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust && typeof rust.usyncParseQueryResult === 'function';

export class USyncQuery {
    constructor() {
        this.protocols = [];
        this.users = [];
        this.context = 'interactive';
        this.mode = 'query';
    }
    withMode(mode) {
        this.mode = mode;
        return this;
    }
    withContext(context) {
        this.context = context;
        return this;
    }
    withUser(user) {
        this.users.push(user);
        return this;
    }
    parseUSyncQueryResult(result) {
        if (result?.attrs?.type !== 'result') {
            return;
        }

        if (useRust) {
            try {
                const protoNames = this.protocols.map(p => p.name);
                const rawJson = JSON.stringify(result);
                const resJson = rust.usyncParseQueryResult(rawJson, JSON.stringify(protoNames));
                const parsed = JSON.parse(resJson);
                // Convert date strings to Date objects to maintain JS parity
                for (const item of parsed.list || []) {
                    if (item.status?.setAt) {
                        item.status.setAt = new Date(item.status.setAt);
                    }
                    if (item.disappearing_mode?.setAt) {
                        item.disappearing_mode.setAt = new Date(item.disappearing_mode.setAt);
                    }
                    if (item.devices?.keyIndex?.signedKeyIndex) {
                        const raw = item.devices.keyIndex.signedKeyIndex;
                        item.devices.keyIndex.signedKeyIndex = Buffer.from(raw.data || raw);
                    }
                }
                return parsed;
            } catch (err) {
                // Fallback to JS parser
            }
        }

        const protocolMap = Object.fromEntries(this.protocols.map(protocol => {
            return [protocol.name, protocol.parser];
        }));
        const queryResult = {
            // TODO: implement errors etc.
            list: [],
            sideList: []
        };
        const usyncNode = getBinaryNodeChild(result, 'usync');
        //TODO: implement error backoff, refresh etc.
        //TODO: see if there are any errors in the result node
        //const resultNode = getBinaryNodeChild(usyncNode, 'result')
        const listNode = usyncNode ? getBinaryNodeChild(usyncNode, 'list') : undefined;
        if (listNode?.content && Array.isArray(listNode.content)) {
            queryResult.list = listNode.content.reduce((acc, node) => {
                const id = node?.attrs.jid;
                if (id) {
                    const data = Array.isArray(node?.content)
                        ? Object.fromEntries(node.content
                            .map(content => {
                            const protocol = content.tag;
                            const parser = protocolMap[protocol];
                            if (parser) {
                                return [protocol, parser(content)];
                            }
                            else {
                                return [protocol, null];
                            }
                        })
                            .filter(([, b]) => b !== null))
                        : {};
                    acc.push({ ...data, id });
                }
                return acc;
            }, []);
        }
        //TODO: implement side list
        //const sideListNode = getBinaryNodeChild(usyncNode, 'side_list')
        return queryResult;
    }
    withDeviceProtocol() {
        this.protocols.push(new USyncDeviceProtocol());
        return this;
    }
    withContactProtocol() {
        this.protocols.push(new USyncContactProtocol());
        return this;
    }
    withStatusProtocol() {
        this.protocols.push(new USyncStatusProtocol());
        return this;
    }
    withDisappearingModeProtocol() {
        this.protocols.push(new USyncDisappearingModeProtocol());
        return this;
    }
    withBotProfileProtocol() {
        this.protocols.push(new USyncBotProfileProtocol());
        return this;
    }
    withLIDProtocol() {
        this.protocols.push(new USyncLIDProtocol());
        return this;
    }
    withUsernameProtocol() {
        this.protocols.push(new USyncUsernameProtocol());
        return this;
    }
}
//# sourceMappingURL=USyncQuery.js.map