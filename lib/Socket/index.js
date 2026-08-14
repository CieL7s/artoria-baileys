import { createRequire } from 'module';
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeCommunitiesSocket } from './communities.js';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');

// export the last socket layer
const makeWASocket = (config) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    const sock = makeCommunitiesSocket(newConfig);

    if (newConfig.printQRInTerminal) {
        sock.ev.on('connection.update', (update) => {
            if (update.qr) {
                try {
                    qrcode.generate(update.qr, { small: true });
                } catch {
                    console.log('\n--- SCAN THIS WHATSAPP QR CODE ---\n' + update.qr + '\n----------------------------------\n');
                }
            }
        });
    }

    return sock;
};
export default makeWASocket;
//# sourceMappingURL=index.js.map