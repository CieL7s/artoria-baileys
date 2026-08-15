import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(__dirname, '../shadow_stats.json');

if (!fs.existsSync(STATS_FILE)) {
    console.log('Belum ada data shadow stats (menunggu traffic grup/pesan lewat)...');
    process.exit(0);
}

const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
console.log('================================================================');
console.log('📊 LIVE SIGNAL SHADOW MODE TELEMETRY REPORT');
console.log('================================================================');
console.log(`⏱️  Mulai Berjalan   : ${stats.startTime}`);
console.log(`⏳ Durasi Aktif     : ${stats.durationSeconds} detik (${(stats.durationSeconds / 60).toFixed(1)} menit)`);
console.log(`🔢 Total Operasi    : ${stats.totalOperations}`);
console.log(`✅ Total Matches    : ${stats.totalOperations - stats.totalMismatches - stats.totalErrors}`);
console.log(`❌ Total Mismatches : ${stats.totalMismatches}`);
console.log(`⚠️  Total Errors     : ${stats.totalErrors}`);
console.log('\n--- Breakdown Per-Operasi ---');
console.table(stats.byOperation);
