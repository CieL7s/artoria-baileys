import { proto } from '../../WAProto/index.js';
import { isLidUser, isPnUser } from '../WABinary/index.js';
import { nativeRust as rust } from './native-loader.js';

const useRust = process.env.SIGNAL_ENGINE !== 'js' && rust && typeof rust.syncProcessContactAction === 'function';

/**
 * Process contactAction and return events to emit.
 * Pure function - no side effects.
 */
export const processContactAction = (action, id, logger) => {
    if (!id) {
        logger?.warn({ hasFullName: !!action?.fullName, hasLidJid: !!action?.lidJid, hasPnJid: !!action?.pnJid }, 'contactAction sync: missing id in index');
        return [];
    }
    if (useRust && action) {
        try {
            const res = rust.syncProcessContactAction(JSON.stringify(action), id);
            if (res) return JSON.parse(res);
        } catch (e) {}
    }
    // JS Fallback
    const results = [];
    const lidJid = action.lidJid;
    const idIsPn = isPnUser(id);
    // PN is in index[1], not in contactAction.pnJid which is usually null
    const phoneNumber = idIsPn ? id : action.pnJid || undefined;
    // Always emit contacts.upsert
    results.push({
        event: 'contacts.upsert',
        data: [
            {
                id,
                name: action.fullName || action.firstName || action.username || undefined,
                username: action.username || undefined,
                lid: lidJid || undefined,
                phoneNumber
            }
        ]
    });
    // Emit lid-mapping.update if we have valid LID-PN pair
    if (lidJid && isLidUser(lidJid) && idIsPn) {
        results.push({
            event: 'lid-mapping.update',
            data: { lid: lidJid, pn: id }
        });
    }
    return results;
};
export const emitSyncActionResults = (ev, results) => {
    for (const result of results) {
        if (result.event === 'contacts.upsert') {
            ev.emit('contacts.upsert', result.data);
        }
        else {
            ev.emit('lid-mapping.update', result.data);
        }
    }
};
//# sourceMappingURL=sync-action-utils.js.map