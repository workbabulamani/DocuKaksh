import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Encryption at rest for uploaded files and preview caches.
//
// File layout: MAGIC, then frames. Each frame is
//   iv (12 bytes) | final flag (1 byte) | length (4 bytes, big endian) | ciphertext | auth tag (16 bytes)
// Every frame is AES-256-GCM with a fresh IV. The chunk index and final flag are authenticated,
// so a chunk cannot be reordered, dropped from the end, or swapped between files without detection.

const MAGIC = Buffer.from('DKENC1\n');
const CHUNK = 1024 * 1024;
const HEADER = 12 + 1 + 4;
const TAG = 16;

export class VaultError extends Error {}

const aad = (index, final) => {
  const buf = Buffer.alloc(9);
  buf.writeBigUInt64BE(BigInt(index), 0);
  buf.writeUInt8(final ? 1 : 0, 8);
  return buf;
};

function sealFrame(key, index, final, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(index, final));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const head = Buffer.alloc(HEADER);
  iv.copy(head, 0);
  head.writeUInt8(final ? 1 : 0, 12);
  head.writeUInt32BE(body.length, 13);
  return Buffer.concat([head, body, cipher.getAuthTag()]);
}

function openFrame(key, index, frame) {
  const iv = frame.subarray(0, 12);
  const final = frame.readUInt8(12) === 1;
  const length = frame.readUInt32BE(13);
  const body = frame.subarray(HEADER, HEADER + length);
  const tag = frame.subarray(HEADER + length, HEADER + length + TAG);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad(index, final));
  decipher.setAuthTag(tag);
  try {
    return { plain: Buffer.concat([decipher.update(body), decipher.final()]), final };
  } catch {
    throw new VaultError('Stored file failed its integrity check');
  }
}

export function createVault(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Vault key must be 32 bytes');

  // Streams plaintext in, produces encrypted frames out.
  class Encrypt extends Transform {
    constructor() {
      super();
      this.pending = Buffer.alloc(0);
      this.index = 0;
      this.push(MAGIC);
    }

    _transform(chunk, _enc, cb) {
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length > CHUNK) {
        const part = this.pending.subarray(0, CHUNK);
        this.pending = this.pending.subarray(CHUNK);
        this.push(sealFrame(key, this.index++, false, part));
      }
      cb();
    }

    _flush(cb) {
      this.push(sealFrame(key, this.index++, true, this.pending));
      cb();
    }
  }

  // Streams encrypted frames in, produces plaintext out. Fails if the file is damaged or truncated.
  class Decrypt extends Transform {
    constructor() {
      super();
      this.pending = Buffer.alloc(0);
      this.index = 0;
      this.headerChecked = false;
      this.sawFinal = false;
    }

    _transform(chunk, _enc, cb) {
      try {
        this.pending = Buffer.concat([this.pending, chunk]);
        if (!this.headerChecked) {
          if (this.pending.length < MAGIC.length) return cb();
          if (!this.pending.subarray(0, MAGIC.length).equals(MAGIC)) throw new VaultError('Not an encrypted file');
          this.pending = this.pending.subarray(MAGIC.length);
          this.headerChecked = true;
        }
        while (this.pending.length >= HEADER) {
          const length = this.pending.readUInt32BE(13);
          const frameSize = HEADER + length + TAG;
          if (this.pending.length < frameSize) break;
          const { plain, final } = openFrame(key, this.index++, this.pending.subarray(0, frameSize));
          this.pending = this.pending.subarray(frameSize);
          if (plain.length) this.push(plain);
          if (final) this.sawFinal = true;
        }
        cb();
      } catch (err) {
        cb(err);
      }
    }

    _flush(cb) {
      if (!this.headerChecked || !this.sawFinal || this.pending.length) {
        return cb(new VaultError('Stored file is truncated'));
      }
      cb();
    }
  }

  return {
    async encryptFile(srcPath, destPath) {
      await pipeline(fs.createReadStream(srcPath), new Encrypt(), fs.createWriteStream(destPath, { mode: 0o600 }));
    },

    decryptStream(filePath) {
      return fs.createReadStream(filePath).pipe(new Decrypt());
    },

    decryptBuffer(filePath) {
      const data = fs.readFileSync(filePath);
      if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new VaultError('Not an encrypted file');
      const parts = [];
      let offset = MAGIC.length;
      let index = 0;
      let sawFinal = false;
      while (offset < data.length) {
        if (data.length - offset < HEADER) throw new VaultError('Stored file is truncated');
        const length = data.readUInt32BE(offset + 13);
        const frameSize = HEADER + length + TAG;
        if (data.length - offset < frameSize) throw new VaultError('Stored file is truncated');
        const { plain, final } = openFrame(key, index++, data.subarray(offset, offset + frameSize));
        parts.push(plain);
        offset += frameSize;
        if (final) sawFinal = true;
      }
      if (!sawFinal) throw new VaultError('Stored file is truncated');
      return Buffer.concat(parts);
    },

    encryptBuffer(destPath, plain) {
      const frames = [MAGIC];
      let index = 0;
      let offset = 0;
      while (plain.length - offset > CHUNK) {
        frames.push(sealFrame(key, index++, false, plain.subarray(offset, offset + CHUNK)));
        offset += CHUNK;
      }
      frames.push(sealFrame(key, index, true, plain.subarray(offset)));
      fs.writeFileSync(destPath, Buffer.concat(frames), { mode: 0o600 });
    },

    // Used by the preview cache and tests. Accepts a Readable of plaintext.
    async encryptReadable(readable, destPath) {
      await pipeline(readable, new Encrypt(), fs.createWriteStream(destPath, { mode: 0o600 }));
    },
  };
}

export const isEncryptedFile = (filePath) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, head, 0, MAGIC.length, 0);
    return head.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
};

export { Readable };
