import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(__dirname, '../../../test/shadow_stats.json');

export const shadowStats = {
    startTime: new Date().toISOString(),
    startTimestamp: Date.now(),
    totalOperations: 0,
    totalMismatches: 0,
    totalErrors: 0,
    byOperation: {
        'SenderChainKey.getSenderMessageKey': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderChainKey.getNext': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderMessageKey.constructor': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderKeyDistributionMessage.parse': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderKeyDistributionMessage.create': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderKeyMessage.parse': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderKeyMessage.verifySignature': { runs: 0, matches: 0, mismatches: 0, errors: 0 },
        'SenderKeyRecord.deserialize': { runs: 0, matches: 0, mismatches: 0, errors: 0 }
    }
};

let lastSave = 0;
function persistStats() {
    const now = Date.now();
    if (now - lastSave < 2000) return; // Debounce disk writes to 2s
    lastSave = now;
    try {
        const payload = {
            ...shadowStats,
            durationSeconds: Math.floor((now - shadowStats.startTimestamp) / 1000),
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {}
}

export const logShadowComparison = (component, isMatch, diffInfo) => {
    shadowStats.totalOperations++;
    if (!shadowStats.byOperation[component]) {
        shadowStats.byOperation[component] = { runs: 0, matches: 0, mismatches: 0, errors: 0 };
    }
    shadowStats.byOperation[component].runs++;

    if (isMatch) {
        shadowStats.byOperation[component].matches++;
    } else {
        shadowStats.totalMismatches++;
        shadowStats.byOperation[component].mismatches++;
        console.error(`[SIGNAL_SHADOW_MISMATCH] Mismatch detected in ${component}!`, diffInfo);
    }
    persistStats();
};

export const logShadowError = (component, error) => {
    shadowStats.totalOperations++;
    shadowStats.totalErrors++;
    if (!shadowStats.byOperation[component]) {
        shadowStats.byOperation[component] = { runs: 0, matches: 0, mismatches: 0, errors: 0 };
    }
    shadowStats.byOperation[component].runs++;
    shadowStats.byOperation[component].errors++;
    console.error(`[SIGNAL_SHADOW_ERROR] Error in ${component}:`, error);
    persistStats();
};

export const getShadowStats = () => {
    const now = Date.now();
    return {
        ...shadowStats,
        durationSeconds: Math.floor((now - shadowStats.startTimestamp) / 1000),
        lastUpdated: new Date().toISOString()
    };
};

// Periodic summary logger every 60 seconds
if (process.env.SIGNAL_SHADOW_MODE === '1') {
    setInterval(() => {
        if (shadowStats.totalOperations === 0) return;
        const durationSec = Math.floor((Date.now() - shadowStats.startTimestamp) / 1000);
        console.log(`\n[SIGNAL_SHADOW_REPORT] ⏱️ Running: ${durationSec}s | Total Ops: ${shadowStats.totalOperations} | Mismatches: ${shadowStats.totalMismatches} | Errors: ${shadowStats.totalErrors}`);
    }, 60000);
}
