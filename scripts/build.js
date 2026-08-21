import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('============================================================');
console.log('       BUILDING ARTORIA-BAILEYS RUST NATIVE ENGINE          ');
console.log('============================================================');

function getPlatformTriple() {
    const { platform, arch } = process;
    if (platform === 'win32') {
        if (arch === 'x64') return 'win32-x64-msvc';
        if (arch === 'arm64') return 'win32-arm64-msvc';
        if (arch === 'ia32') return 'win32-ia32-msvc';
    }
    if (platform === 'darwin') {
        if (arch === 'arm64') return 'darwin-arm64';
        if (arch === 'x64') return 'darwin-x64';
    }
    if (platform === 'linux') {
        return `linux-${arch}-gnu`;
    }
    return `${platform}-${arch}`;
}

const triple = getPlatformTriple();
console.log(`[1/3] Platform Target Triple: ${triple}`);

console.log('[2/3] Compiling Rust release addon via Cargo (lto=fat, opt-level=3)...');
execSync('cargo build --package baileys-napi --release', {
    cwd: path.join(rootDir, 'rust'),
    stdio: 'inherit',
    env: {
        ...process.env,
        RUSTFLAGS: process.env.RUSTFLAGS || '-C target-cpu=native'
    }
});

console.log('[3/3] Copying binary to prebuilt target locations...');
const possibleOutputs = [
    path.join(rootDir, 'rust/target/release/baileys_napi.dll'),
    path.join(rootDir, 'rust/target/release/libbaileys_napi.so'),
    path.join(rootDir, 'rust/target/release/libbaileys_napi.dylib'),
    path.join(rootDir, 'rust/target/release/baileys_napi.node')
];

let sourceBinary = null;
for (const p of possibleOutputs) {
    if (fs.existsSync(p)) {
        sourceBinary = p;
        break;
    }
}

if (!sourceBinary) {
    console.error('❌ Build failed: output dynamic library not found in target/release!');
    process.exit(1);
}

const targetBundled = path.join(rootDir, `baileys-napi.${triple}.node`);
const targetGeneric = path.join(rootDir, 'baileys-napi.node');

function safeCopy(src, dst) {
    try {
        fs.copyFileSync(src, dst);
    } catch (err) {
        if (err.code === 'EBUSY') {
            console.warn(`[WARN] Destination ${dst} is locked. Retrying after unlink...`);
            try {
                fs.unlinkSync(dst);
                fs.copyFileSync(src, dst);
            } catch (unlinkErr) {
                console.error(`[ERROR] Could not overwrite ${dst}:`, unlinkErr.message);
            }
        } else {
            throw err;
        }
    }
}

safeCopy(sourceBinary, targetBundled);
safeCopy(sourceBinary, targetGeneric);

const stats = fs.statSync(targetBundled);
console.log(`  ✓ Successfully built & copied to:`);
console.log(`    - ${targetBundled} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`    - ${targetGeneric}`);
console.log('============================================================');
console.log('       AURIEL-BAILEYS BUILD COMPLETED SUCCESSFULLY!         ');
console.log('============================================================');
