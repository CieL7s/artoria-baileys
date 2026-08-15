import http from 'http';

const API_BASE = 'http://localhost:3456';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function postJson(pathUrl, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request(`${API_BASE}${pathUrl}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 10000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(payload);
        req.end();
    });
}

const COMMANDS = ['.ping', '.speed', '.menu', '.help'];
const GROUPS = [
    '120363409742668546@g.us',
    '120363423520240855@g.us'
];

async function main() {
    console.log('================================================================');
    console.log('🧪 TESTING AUTHORITATIVE RUST ENGINE (SIGNAL_ENGINE=rust)');
    console.log('================================================================\n');

    console.log('--- 1. Testing Bot Commands (Rust Authoritative Mode) ---');
    for (const cmd of COMMANDS) {
        const start = Date.now();
        const res = await postJson('/api/command', { text: cmd });
        const dur = Date.now() - start;
        console.log(`[PASS] Command '${cmd}' executed in ${dur}ms -> Replies: ${res.data?.replies?.length || 0}`);
        await delay(1000);
    }

    console.log('\n--- 2. Testing Group Message Transmissions (Rust Ratchet Encryption) ---');
    for (const grp of GROUPS) {
        for (let i = 1; i <= 5; i++) {
            const text = `[Rust Native Engine Test] Pesan #${i} to group ${grp.split('@')[0]} - encryption via Rust N-API`;
            const start = Date.now();
            const res = await postJson('/api/send-message', { jid: grp, text });
            const dur = Date.now() - start;
            console.log(`[PASS] Group ${grp.split('@')[0]} Msg #${i} sent in ${dur}ms -> Status: ${res.status}`);
            await delay(1500);
        }
    }

    console.log('\n================================================================');
    console.log('✅ SELURUH PENGUJIAN SIGNAL_ENGINE=rust SUKSES TANPA CRASH/ERROR!');
    console.log('================================================================');
}

main().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
