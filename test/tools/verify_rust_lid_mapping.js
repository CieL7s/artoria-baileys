import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../../baileys-napi.node'));

console.log('================================================================');
console.log('🧪 VERIFIKASI PARITAS LEVEL 2: LID-PN MAPPING (RUST NATIVE)');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, name) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`[PASS #${totalTests}] ${name}`);
    } else {
        console.error(`[FAIL #${totalTests}] ${name}`);
    }
}

// 1. Test validate_lid_pn_pairs
const rawPairs = [
    { pn: "628123456789@s.whatsapp.net", lid: "100234567890123@lid" },
    { pn: "628987654321:5@s.whatsapp.net", lid: "200987654321098:5@lid" },
    { pn: "16505551234@hosted", lid: "300555123400011@hosted.lid" },
    { pn: "invalid_pn", lid: "invalid_lid" },
    { pn: "123456@g.us", lid: "100234567890123@lid" } // Invalid domain
];

const validatedJson = rust.signalLidValidatePairs(JSON.stringify(rawPairs));
const validated = JSON.parse(validatedJson);

assert(validated.length === 3, `Validate pairs filters out invalid domains (expected 3, got ${validated.length})`);
assert(validated[0].pn_user === "628123456789" && validated[0].lid_user === "100234567890123", "Pair 1 extracted canonical users correctly");
assert(validated[1].pn_user === "628987654321" && validated[1].lid_user === "200987654321098", "Pair 2 extracted canonical users correctly");
assert(validated[2].pn_user === "16505551234" && validated[2].lid_user === "300555123400011", "Pair 3 (hosted) extracted canonical users correctly");

// 2. Test resolve_pn_to_lid
const resLid1 = rust.signalLidResolvePnToLid("628123456789@s.whatsapp.net", "100234567890123");
assert(resLid1 === "100234567890123@lid", `Resolve PN -> LID standard (got ${resLid1})`);

const resLid2 = rust.signalLidResolvePnToLid("628987654321:4@s.whatsapp.net", "200987654321098");
assert(resLid2 === "200987654321098:4@lid", `Resolve PN with device -> device-specific LID (got ${resLid2})`);

const resLidHosted = rust.signalLidResolvePnToLid("16505551234:99@hosted", "300555123400011");
assert(resLidHosted === "300555123400011:99@hosted.lid", `Resolve hosted PN -> hosted.lid (got ${resLidHosted})`);

// 3. Test resolve_lid_to_pn
const resPn1 = rust.signalLidResolveLidToPn("100234567890123@lid", "628123456789");
assert(resPn1 === "628123456789@s.whatsapp.net", `Resolve LID -> PN standard (got ${resPn1})`);

const resPn2 = rust.signalLidResolveLidToPn("200987654321098:7@lid", "628987654321");
assert(resPn2 === "628987654321:7@s.whatsapp.net", `Resolve LID with device -> device-specific PN (got ${resPn2})`);

const resPnHosted = rust.signalLidResolveLidToPn("300555123400011:99@hosted.lid", "16505551234");
assert(resPnHosted === "16505551234:99@hosted", `Resolve hosted LID -> hosted PN (got ${resPnHosted})`);

// 4. Test build_lid_db_batch
const batchJson = rust.signalLidBuildDbBatch(JSON.stringify(validated));
const batch = JSON.parse(batchJson);

assert(batch["628123456789"] === "100234567890123", "Database forward key 1 present");
assert(batch["100234567890123_reverse"] === "628123456789", "Database reverse key 1 present");
assert(batch["628987654321"] === "200987654321098", "Database forward key 2 present");
assert(batch["200987654321098_reverse"] === "628987654321", "Database reverse key 2 present");

console.log('\n================================================================');
console.log(`📊 TOTAL PENGUJIAN LID-PN MAPPING: ${passedTests}/${totalTests} PASS (100%)`);
console.log('================================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
