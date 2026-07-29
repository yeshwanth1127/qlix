import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proto } from '@whiskeysockets/baileys';
import baileysPkg from '@whiskeysockets/baileys';

const { initAuthCreds, BufferJSON } = baileysPkg;

/**
 * Baileys' own `useMultiFileAuthState` writes every session/sender-key/creds file as
 * plaintext JSON — a filesystem compromise on this host hijacks every connected
 * organization's live WhatsApp session. This is a drop-in replacement with the exact
 * same file layout and behavior, except each file's contents are AES-256-GCM
 * encrypted before being written and decrypted after being read.
 */
function loadEncryptionKey() {
  const raw = process.env.WHATSAPP_AUTH_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'WHATSAPP_AUTH_ENCRYPTION_KEY is required (32 bytes: 64 hex chars, or base64 for 32 bytes). ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('WHATSAPP_AUTH_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64 for 32 bytes)');
  }
  return buf;
}

function encryptJson(key, value) {
  const plaintext = JSON.stringify(value, BufferJSON.replacer);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

function decryptJson(key, encoded) {
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted auth-state file format');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext, BufferJSON.reviver);
}

const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

// Simple per-path write/read queue (Baileys uses `async-mutex` internally for the same
// reason: concurrent creds.update/keys.set calls must not interleave on one file).
const fileLocks = new Map();
function withFileLock(path, fn) {
  const prev = fileLocks.get(path) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  fileLocks.set(
    path,
    next.catch(() => {}),
  );
  return next;
}

/**
 * One-time upgrade path: an auth dir written by the old plaintext `useMultiFileAuthState`
 * has `.json` files starting with `{`/`[`; encrypted files start with `v1:`. Re-encrypts
 * any plaintext file found in place so already-linked sessions don't have to re-scan the
 * QR code just because this fix shipped.
 */
export async function migratePlaintextAuthDir(folder) {
  const key = loadEncryptionKey();
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = join(folder, entry.name);
    const raw = await readFile(filePath, 'utf-8').catch(() => null);
    if (raw == null) continue;
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('v1:')) continue; // already encrypted
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue; // unrecognized, leave alone
    try {
      const parsed = JSON.parse(raw, BufferJSON.reviver);
      await writeFile(filePath, encryptJson(key, parsed));
      migrated += 1;
    } catch {
      // not valid JSON — leave alone rather than risk destroying an unrelated file
    }
  }
  return migrated;
}

export async function useEncryptedMultiFileAuthState(folder) {
  const key = loadEncryptionKey();

  const writeData = (data, file) => {
    const filePath = join(folder, fixFileName(file));
    return withFileLock(filePath, () => writeFile(filePath, encryptJson(key, data)));
  };
  const readData = (file) => {
    const filePath = join(folder, fixFileName(file));
    return withFileLock(filePath, async () => {
      try {
        const raw = await readFile(filePath, { encoding: 'utf-8' });
        return decryptJson(key, raw);
      } catch {
        return null;
      }
    });
  };
  const removeData = (file) => {
    const filePath = join(folder, fixFileName(file));
    return withFileLock(filePath, async () => {
      try {
        await unlink(filePath);
      } catch {
        // ignore
      }
    });
  };

  const folderInfo = await stat(folder).catch(() => undefined);
  if (folderInfo) {
    if (!folderInfo.isDirectory()) {
      throw new Error(`found something that is not a directory at ${folder}, either delete it or specify a different location`);
    }
  } else {
    await mkdir(folder, { recursive: true });
  }

  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds.json'),
  };
}
