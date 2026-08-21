import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const pureBaileysDir = process.env.PURE_JS_BAILEYS_PATH || 'C:/Users/ASUS/Documents/Project/baileys-onrust/Baileys/lib';
const artoriaDir = path.join(PROJECT_ROOT, 'lib');

console.log('Testing module loading...');

// 1. WABinary
const jsWABinary = await import(pathToFileURL(path.join(pureBaileysDir, 'WABinary/index.js')).href);
const rustWABinary = await import(pathToFileURL(path.join(artoriaDir, 'WABinary/index.js')).href);
console.log('✓ WABinary loaded (JS & Rust)');

// 2. Utils
const jsMessages = await import(pathToFileURL(path.join(pureBaileysDir, 'Utils/messages.js')).href);
const rustMessages = await import(pathToFileURL(path.join(artoriaDir, 'Utils/messages.js')).href);
console.log('✓ Messages loaded (JS & Rust)');

// 3. Signal
const jsSignal = await import(pathToFileURL(path.join(pureBaileysDir, 'Signal/libsignal.js')).href);
const rustSignal = await import(pathToFileURL(path.join(artoriaDir, 'Signal/libsignal.js')).href);
console.log('✓ Signal loaded (JS & Rust)');

console.log('ALL MODULES LOADED CLEANLY!');
