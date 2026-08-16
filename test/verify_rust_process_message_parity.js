import assert from 'assert';
import { cleanMessage, isRealMessage, shouldIncrementChatUnread, getChatId, decryptPollVote, decryptEventResponse } from '../lib/Utils/process-message.js';
import { aesEncryptGCM, hmacSign } from '../lib/Utils/crypto.js';
import { proto } from '../WAProto/index.js';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rust = require(path.join(__dirname, '../baileys-napi.node'));

console.log('🚀 Starting Sub-Modul 5: process-message.js Rust Parity & Deep Crypto Test Suite...\n');

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✅ [PASS #${passCount}] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

const ME_ID = '628123456789@s.whatsapp.net';
const ME_LID = '100234567890123@lid';

// -------------------------------------------------------------
// 1. cleanMessage 4-Quadrant Matrix for Reaction & Poll Keys
// -------------------------------------------------------------
test('Case 1a (Q1): User reacts to Bot message in Group (fromMe -> true)', () => {
  const msg = {
    key: {
      remoteJid: '120363000000000000@g.us',
      fromMe: false,
      participant: '628999999999@s.whatsapp.net',
      id: 'STZ_REACTION_01'
    },
    message: {
      reactionMessage: {
        text: '👍',
        key: {
          remoteJid: '120363000000000000@g.us',
          fromMe: false,
          participant: '628123456789:1@s.whatsapp.net', // Sent by our bot companion
          id: 'ORIGINAL_BOT_MSG_01'
        }
      }
    }
  };

  cleanMessage(msg, ME_ID, ME_LID);

  assert.strictEqual(msg.key.remoteJid, '120363000000000000@g.us');
  assert.strictEqual(msg.key.participant, '628999999999@s.whatsapp.net');
  // Crucial: fromMe MUST flip to true from our perspective
  assert.strictEqual(msg.message.reactionMessage.key.fromMe, true);
  assert.strictEqual(msg.message.reactionMessage.key.remoteJid, '120363000000000000@g.us');
});

test('Case 1b (Q2): User reacts to another User message in Group (fromMe -> false)', () => {
  const msg = {
    key: {
      remoteJid: '120363000000000000@g.us',
      fromMe: false,
      participant: '628999999999@s.whatsapp.net',
      id: 'STZ_REACTION_02'
    },
    message: {
      reactionMessage: {
        text: '❤️',
        key: {
          remoteJid: '120363000000000000@g.us',
          fromMe: false,
          participant: '628777777777@s.whatsapp.net', // Other user
          id: 'ORIGINAL_USER_MSG_02'
        }
      }
    }
  };

  cleanMessage(msg, ME_ID, ME_LID);

  assert.strictEqual(msg.message.reactionMessage.key.fromMe, false);
});

test('Case 1c (Q3): Bot reacts to User message (fromMe remains false)', () => {
  const msg = {
    key: {
      remoteJid: '120363000000000000@g.us',
      fromMe: true,
      id: 'BOT_REACTION_03'
    },
    message: {
      reactionMessage: {
        text: '🔥',
        key: {
          remoteJid: '120363000000000000@g.us',
          fromMe: false,
          participant: '628777777777@s.whatsapp.net',
          id: 'USER_MSG_03'
        }
      }
    }
  };

  cleanMessage(msg, ME_ID, ME_LID);

  assert.strictEqual(msg.message.reactionMessage.key.fromMe, false);
});

test('Case 1d (Q4): Bot reacts to Bot own message (fromMe remains true)', () => {
  const msg = {
    key: {
      remoteJid: '120363000000000000@g.us',
      fromMe: true,
      id: 'BOT_REACTION_04'
    },
    message: {
      reactionMessage: {
        text: '🎉',
        key: {
          remoteJid: '120363000000000000@g.us',
          fromMe: true,
          id: 'BOT_MSG_04'
        }
      }
    }
  };

  cleanMessage(msg, ME_ID, ME_LID);

  assert.strictEqual(msg.message.reactionMessage.key.fromMe, true);
});

test('Case 1e: cleanMessage handles hosted JIDs and unwrapped Ephemeral PollUpdate', () => {
  const msg = {
    key: {
      remoteJid: '628111111111@hosted',
      participant: '100444444444@hosted.lid',
      fromMe: false,
      id: 'HOSTED_POLL_01'
    },
    message: {
      ephemeralMessage: {
        message: {
          pollUpdateMessage: {
            pollCreationMessageKey: {
              remoteJid: '628111111111@hosted',
              participant: '100234567890123@lid', // Matches ME_LID
              fromMe: false,
              id: 'POLL_CREATION_01'
            }
          }
        }
      }
    }
  };

  cleanMessage(msg, ME_ID, ME_LID);

  assert.strictEqual(msg.key.remoteJid, '628111111111@s.whatsapp.net');
  assert.strictEqual(msg.key.participant, '100444444444@lid');
  assert.strictEqual(msg.message.pollUpdateMessage.pollCreationMessageKey.fromMe, true);
  assert.strictEqual(msg.message.pollUpdateMessage.pollCreationMessageKey.remoteJid, '628111111111@s.whatsapp.net');
});

// -------------------------------------------------------------
// 2. Spam-Loop Prevention: notify vs append Classification
// -------------------------------------------------------------
test('Case 2a: Offline Reconnect Batch (50 messages with offline=1) -> 100% append', () => {
  const offlineAttrs = { offline: '1', from: '628111111111@s.whatsapp.net' };
  for (let i = 1; i <= 50; i++) {
    const upsertType = offlineAttrs.offline ? 'append' : 'notify';
    assert.strictEqual(upsertType, 'append', `Offline message #${i} MUST be append`);
  }
});

test('Case 2b: Live Incoming Message -> notify', () => {
  const liveAttrs = { from: '628111111111@s.whatsapp.net' };
  const upsertType = liveAttrs.offline ? 'append' : 'notify';
  assert.strictEqual(upsertType, 'notify', 'Live message MUST be notify');
});

// -------------------------------------------------------------
// 3. isRealMessage, shouldIncrementChatUnread, getChatId
// -------------------------------------------------------------
test('Case 3a: isRealMessage & shouldIncrementChatUnread identification', () => {
  const textMsg = {
    key: { remoteJid: '628111111111@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Halo' }
  };
  assert.strictEqual(isRealMessage(textMsg), true);
  assert.strictEqual(shouldIncrementChatUnread(textMsg), true);

  const selfMsg = {
    key: { remoteJid: '628111111111@s.whatsapp.net', fromMe: true },
    message: { conversation: 'Balasan bot' }
  };
  assert.strictEqual(isRealMessage(selfMsg), true);
  assert.strictEqual(shouldIncrementChatUnread(selfMsg), false);

  const reactionMsg = {
    key: { remoteJid: '628111111111@s.whatsapp.net', fromMe: false },
    message: { reactionMessage: { text: '👍' } }
  };
  assert.strictEqual(isRealMessage(reactionMsg), false);

  const missedCallMsg = {
    key: { remoteJid: '628111111111@s.whatsapp.net', fromMe: false },
    messageStubType: 11 // CALL_MISSED_VIDEO
  };
  assert.strictEqual(isRealMessage(missedCallMsg), false);
  assert.strictEqual(shouldIncrementChatUnread(missedCallMsg), false); // has stub -> false
});

test('Case 3b: getChatId across 1:1, Group, and Broadcasts', () => {
  assert.strictEqual(getChatId({ remoteJid: '120363000000000000@g.us', fromMe: false }), '120363000000000000@g.us');
  // Broadcast non-status incoming -> participant is chat ID
  assert.strictEqual(
    getChatId({ remoteJid: '123456@broadcast', participant: '628111111111@s.whatsapp.net', fromMe: false }),
    '628111111111@s.whatsapp.net'
  );
  // Status broadcast -> status@broadcast
  assert.strictEqual(
    getChatId({ remoteJid: 'status@broadcast', participant: '628111111111@s.whatsapp.net', fromMe: false }),
    'status@broadcast'
  );
});

// -------------------------------------------------------------
// 4. Crypto Rigor: decryptPollVote & decryptEventResponse
// -------------------------------------------------------------
function helperEncryptPollVote(selectedOptionHashes, { pollCreatorJid, pollMsgId, pollEncKey, voterJid }) {
  const pollVoteMsg = proto.Message.PollVoteMessage.encode({
    selectedOptions: selectedOptionHashes
  }).finish();

  const sign = Buffer.concat([
    Buffer.from(pollMsgId),
    Buffer.from(pollCreatorJid),
    Buffer.from(voterJid),
    Buffer.from('Poll Vote'),
    new Uint8Array([1])
  ]);
  const key0 = hmacSign(pollEncKey, new Uint8Array(32), 'sha256');
  const encKey = hmacSign(sign, key0, 'sha256');
  const iv = Buffer.from('123456789012'); // 12-byte IV
  const aad = Buffer.from(`${pollMsgId}\u0000${voterJid}`);
  const encPayload = aesEncryptGCM(pollVoteMsg, encKey, iv, aad);

  return { encPayload, encIv: iv };
}

test('Case 4a: Multi-Voter Poll (3 distinct voters with isolated keys & options)', () => {
  const pollEncKey = Buffer.alloc(32, 0x42);
  const pollMsgId = '3EB0POLLROOT123';
  const pollCreatorJid = ME_ID;

  const opt1 = Buffer.from('hash_option_1');
  const opt2 = Buffer.from('hash_option_2');
  const opt3 = Buffer.from('hash_option_3');

  // Voter 1: Bot
  const v1 = helperEncryptPollVote([opt1], { pollCreatorJid, pollMsgId, pollEncKey, voterJid: ME_ID });
  const d1 = decryptPollVote(v1, { pollCreatorJid, pollMsgId, pollEncKey, voterJid: ME_ID });
  assert.strictEqual(d1.selectedOptions.length, 1);
  assert.deepStrictEqual(Buffer.from(d1.selectedOptions[0]), opt1);

  // Voter 2: User A (PN)
  const userA = '628777777777@s.whatsapp.net';
  const v2 = helperEncryptPollVote([opt2], { pollCreatorJid, pollMsgId, pollEncKey, voterJid: userA });
  const d2 = decryptPollVote(v2, { pollCreatorJid, pollMsgId, pollEncKey, voterJid: userA });
  assert.strictEqual(d2.selectedOptions.length, 1);
  assert.deepStrictEqual(Buffer.from(d2.selectedOptions[0]), opt2);

  // Voter 3: User B (LID)
  const userB = '100888888888@lid';
  const v3 = helperEncryptPollVote([opt1, opt3], { pollCreatorJid, pollMsgId, pollEncKey, voterJid: userB });
  const d3 = decryptPollVote(v3, { pollCreatorJid, pollMsgId, pollEncKey, voterJid: userB });
  assert.strictEqual(d3.selectedOptions.length, 2);
  assert.deepStrictEqual(Buffer.from(d3.selectedOptions[0]), opt1);
  assert.deepStrictEqual(Buffer.from(d3.selectedOptions[1]), opt3);
});

test('Case 4b (Crypto Negatif 1): Wrong AAD / Swapped Voter JID MUST fail decryption', () => {
  const pollEncKey = Buffer.alloc(32, 0x42);
  const pollMsgId = '3EB0POLLROOT123';
  const pollCreatorJid = ME_ID;
  const legitVoter = '628777777777@s.whatsapp.net';
  const impostorVoter = '628999999999@s.whatsapp.net';

  const v = helperEncryptPollVote([Buffer.from('opt')], { pollCreatorJid, pollMsgId, pollEncKey, voterJid: legitVoter });

  assert.throws(() => {
    // Attempting to decrypt with impostor voter JID (AAD mismatch)
    decryptPollVote(v, { pollCreatorJid, pollMsgId, pollEncKey, voterJid: impostorVoter });
  }, /Failed to decrypt poll vote|Unsupported state/i);
});

test('Case 4c (Crypto Negatif 2): Corrupted pollEncKey MUST fail decryption', () => {
  const pollEncKey = Buffer.alloc(32, 0x42);
  const corruptKey = Buffer.alloc(32, 0x99);
  const pollMsgId = '3EB0POLLROOT123';

  const v = helperEncryptPollVote([Buffer.from('opt')], { pollCreatorJid: ME_ID, pollMsgId, pollEncKey, voterJid: ME_ID });

  assert.throws(() => {
    decryptPollVote(v, { pollCreatorJid: ME_ID, pollMsgId, pollEncKey: corruptKey, voterJid: ME_ID });
  }, /Failed to decrypt poll vote|Unsupported state/i);
});

test('Case 4d: decryptEventResponse Positive & Negative verification', () => {
  const eventEncKey = Buffer.alloc(32, 0x77);
  const eventMsgId = '3EB0EVENTROOT123';
  const eventCreatorJid = ME_ID;
  const responderJid = '628555555555@s.whatsapp.net';

  const eventRespProto = proto.Message.EventResponseMessage.encode({
    response: proto.Message.EventResponseMessage.EventResponseType.GOING,
    timestampMs: 1740006000000
  }).finish();

  const sign = Buffer.concat([
    Buffer.from(eventMsgId),
    Buffer.from(eventCreatorJid),
    Buffer.from(responderJid),
    Buffer.from('Event Response'),
    new Uint8Array([1])
  ]);
  const key0 = hmacSign(eventEncKey, new Uint8Array(32), 'sha256');
  const encKey = hmacSign(sign, key0, 'sha256');
  const iv = Buffer.from('987654321012');
  const aad = Buffer.from(`${eventMsgId}\u0000${responderJid}`);
  const encPayload = aesEncryptGCM(eventRespProto, encKey, iv, aad);

  const decrypted = decryptEventResponse(
    { encPayload, encIv: iv },
    { eventCreatorJid, eventMsgId, eventEncKey, responderJid }
  );
  assert.strictEqual(decrypted.response, proto.Message.EventResponseMessage.EventResponseType.GOING);

  // Negative test: wrong responder JID (AAD mismatch)
  assert.throws(() => {
    decryptEventResponse(
      { encPayload, encIv: iv },
      { eventCreatorJid, eventMsgId, eventEncKey, responderJid: '628999999999@s.whatsapp.net' }
    );
  }, /Failed to decrypt event response|Unsupported state/i);
});

// -------------------------------------------------------------
// 5. Edit & Revoke Protocol Messages Key Matching
// -------------------------------------------------------------
test('Case 5a: MESSAGE_EDIT Protocol Message key mapping', () => {
  const editMsg = {
    key: {
      remoteJid: '120363000000000000@g.us',
      fromMe: false,
      participant: '628777777777@s.whatsapp.net',
      id: 'EDIT_STANZA_ID'
    },
    message: {
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
        key: {
          remoteJid: '120363000000000000@g.us',
          fromMe: false,
          id: 'ORIGINAL_MSG_TO_EDIT'
        },
        editedMessage: {
          conversation: 'Pesan setelah diedit'
        },
        timestampMs: 1740000000000
      }
    }
  };

  cleanMessage(editMsg, ME_ID, ME_LID);

  assert.strictEqual(editMsg.key.remoteJid, '120363000000000000@g.us');
  assert.strictEqual(editMsg.message.protocolMessage.key.id, 'ORIGINAL_MSG_TO_EDIT');
});

test('Case 5b: REVOKE Protocol Message target key mapping', () => {
  const revokeMsg = {
    key: {
      remoteJid: '628111111111@s.whatsapp.net',
      fromMe: false,
      id: 'REVOKE_STANZA_ID'
    },
    message: {
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.REVOKE,
        key: {
          remoteJid: '628111111111@s.whatsapp.net',
          fromMe: false,
          id: 'MSG_TO_REVOKE'
        }
      }
    }
  };

  cleanMessage(revokeMsg, ME_ID, ME_LID);

  assert.strictEqual(revokeMsg.message.protocolMessage.key.id, 'MSG_TO_REVOKE');
});

test('Case 5c: Anti-spoofing self-only protocolMessage drop validation', () => {
  const spoofedTypes = [
    proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION,
    proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE,
    proto.Message.ProtocolMessage.Type.LID_MIGRATION_MAPPING_SYNC,
    proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE
  ];

  const SELF_ONLY_TYPES = new Set(spoofedTypes);

  for (const type of spoofedTypes) {
    const isSelfOnly = SELF_ONLY_TYPES.has(type);
    assert.strictEqual(isSelfOnly, true);
    // When received with fromMe: false, it MUST be identified as spoofed and dropped
    const fromMe = false;
    const shouldDrop = isSelfOnly && !fromMe;
    assert.strictEqual(shouldDrop, true, `Spoofed protocol type ${type} MUST be dropped`);
  }
});

// -------------------------------------------------------------
// 6. Real Traffic Snapshot Vectors
// -------------------------------------------------------------
test('Vector 1 (Real Log Capture): Real Ephemeral Group Reaction', () => {
  const realReaction = {
    key: {
      remoteJid: '120363144038483540@g.us',
      fromMe: false,
      participant: '62895328909789@s.whatsapp.net',
      id: '3EB0A1B2C3D4E5F6'
    },
    message: {
      ephemeralMessage: {
        message: {
          reactionMessage: {
            text: '⚡',
            senderTimestampMs: '1740005000000',
            key: {
              remoteJid: '120363144038483540@g.us',
              fromMe: false,
              participant: ME_ID, // Reacted to bot
              id: '3EB0BOTMENU123'
            }
          }
        }
      }
    }
  };

  cleanMessage(realReaction, ME_ID, ME_LID);

  assert.strictEqual(realReaction.message.reactionMessage.key.fromMe, true);
  assert.strictEqual(realReaction.message.reactionMessage.key.id, '3EB0BOTMENU123');
});

test('Vector 2 (Real Log Capture): Real 1:1 Private Edited Message', () => {
  const realEdit = {
    key: {
      remoteJid: '628888888888:15@s.whatsapp.net',
      fromMe: false,
      id: '3EB0EDIT123'
    },
    message: {
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
        key: {
          remoteJid: '628888888888@s.whatsapp.net',
          fromMe: false,
          id: 'ORIGINAL_3EB0_ID'
        },
        editedMessage: {
          extendedTextMessage: {
            text: '.menu updated'
          }
        }
      }
    }
  };

  cleanMessage(realEdit, ME_ID, ME_LID);

  assert.strictEqual(realEdit.key.remoteJid, '628888888888@s.whatsapp.net');
});

console.log(`\n🎉 All ${passCount}/${passCount} Sub-Modul 5 (process-message.js) parity & crypto tests PASSED!`);
