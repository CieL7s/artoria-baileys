import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const tag = process.argv[2] || 'v0.6.3';

async function downloadReleaseBinaries() {
    console.log(`============================================================`);
    console.log(`   DOWNLOADING NATIVE BINARIES FROM GITHUB RELEASE (${tag})  `);
    console.log(`============================================================`);

    const apiUrl = `https://api.github.com/repos/CieL7s/artoria-baileys/releases/tags/${tag}`;
    const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Artoria-Baileys-Release-Downloader' }
    });

    if (!res.ok) {
        console.error(`❌ Failed to fetch release metadata: HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.error(text);
        process.exit(1);
    }

    const release = await res.json();
    console.log(`Found Release: "${release.name || release.tag_name}" with ${release.assets?.length || 0} assets.`);

    if (!release.assets || release.assets.length === 0) {
        console.error('❌ No assets found in release yet! Make sure CI release job has completed.');
        process.exit(1);
    }

    for (const asset of release.assets) {
        const targetPath = path.join(rootDir, asset.name);
        console.log(`⬇️  Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)...`);

        const downloadRes = await fetch(asset.browser_download_url, {
            headers: { 'User-Agent': 'Artoria-Baileys-Release-Downloader' },
            redirect: 'follow'
        });

        if (!downloadRes.ok) {
            console.error(`❌ Failed to download ${asset.name}: HTTP ${downloadRes.status}`);
            continue;
        }

        const buffer = Buffer.from(await downloadRes.arrayBuffer());
        fs.writeFileSync(targetPath, buffer);
        console.log(`  ✓ Saved to ${targetPath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    }

    console.log(`============================================================`);
    console.log(`   ALL PREBUILT BINARIES DOWNLOADED SUCCESSFULLY!           `);
    console.log(`============================================================`);
}

downloadReleaseBinaries().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
