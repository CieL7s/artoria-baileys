import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * Detect whether the current Linux environment uses musl libc (e.g. Alpine Linux) or glibc.
 * Uses a robust multi-heuristic detection strategy:
 * 1. Check Node.js process report header (glibcVersionRuntime is present on glibc).
 * 2. Check /etc/alpine-release file presence.
 * 3. Check /lib/ld-musl-* or /lib/libc.musl-* dynamic linker files.
 */
function isMusl() {
    // Non-Linux is never musl
    if (process.platform !== 'linux') {
        return false;
    }

    // Heuristic 1: Node.js process report inspection
    try {
        const report = process.report?.getReport?.();
        if (report?.header) {
            if (report.header.glibcVersionRuntime) {
                return false;
            }
        }
    } catch {
        // Continue to other heuristics
    }

    // Heuristic 2: Check Alpine release indicator
    try {
        if (fs.existsSync('/etc/alpine-release')) {
            return true;
        }
    } catch {
        // Continue
    }

    // Heuristic 3: Check musl shared library presence
    try {
        const libFiles = ['/lib/ld-musl-x86_64.so.1', '/lib/ld-musl-aarch64.so.1', '/lib/libc.musl-x86_64.so.1'];
        for (const f of libFiles) {
            if (fs.existsSync(f)) {
                return true;
            }
        }
    } catch {
        // Continue
    }

    // Default to glibc on Linux if no musl indicators found
    return false;
}

/**
 * Resolve the standard N-API target triple string based on current platform & architecture.
 */
export function getPlatformTriple() {
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
        const libcType = isMusl() ? 'musl' : 'gnu';
        if (arch === 'x64') return `linux-x64-${libcType}`;
        if (arch === 'arm64') return `linux-arm64-${libcType}`;
        if (arch === 'arm') return `linux-arm-${libcType}`;
    }

    return `${platform}-${arch}`;
}

/**
 * Load the native Rust binary addon across all supported platforms with graceful fallback.
 */
function loadNativeBinding() {
    const platformTriple = getPlatformTriple();
    const rootDir = path.resolve(__dirname, '../../');

    const candidatePaths = [
        // 1. Platform-specific prebuilt binary in root (All-in-One Bundled pattern)
        path.join(rootDir, `baileys-napi.${platformTriple}.node`),
        
        // 2. Generic prebuilt binary in root
        path.join(rootDir, 'baileys-napi.node'),
        path.join(rootDir, 'baileys_napi.node'),

        // 3. Local cargo build output (dev / build from source)
        path.join(rootDir, 'rust/target/release/baileys_napi.node'),
        path.join(rootDir, 'rust/target/release/baileys_napi.dll'),
        path.join(rootDir, 'rust/target/release/libbaileys_napi.so'),
        path.join(rootDir, 'rust/target/release/libbaileys_napi.dylib')
    ];

    for (const candidate of candidatePaths) {
        try {
            if (fs.existsSync(candidate)) {
                const binding = require(candidate);
                if (binding && typeof binding === 'object') {
                    return binding;
                }
            }
        } catch (err) {
            // Log in debug mode only, otherwise try next candidate
            if (process.env.DEBUG_NAPI) {
                console.warn(`[Artoria-Baileys] Failed to load N-API candidate ${candidate}:`, err.message);
            }
        }
    }

    return null;
}

// Single singleton native instance shared across entire package
export const nativeRust = loadNativeBinding();
export default nativeRust;
