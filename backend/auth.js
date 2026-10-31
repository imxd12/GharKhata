/**
 * GharKhata – Authentication & Cryptography Utilities
 * Provides secure password hashing (scrypt + random salt), JWT-compatible HMAC token signing,
 * and Household ID generation.
 */

const crypto = require('node:crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'gharkhata_secure_family_secret_key_82m9_xp41';

/**
 * Hash a password using scrypt with a unique random salt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return {
    salt,
    hash: derivedKey.toString('hex')
  };
}

/**
 * Verify a password against stored salt and hash
 */
function verifyPassword(password, salt, storedHash) {
  const derivedKey = crypto.scryptSync(password, salt, 64);
  const calculatedHash = derivedKey.toString('hex');
  return crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(storedHash));
}

/**
 * Generate a unique Household ID
 * Example format: GHK-82M9-XP41
 */
function generateHouseholdId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32-like, readable, no confusing 0/O/1/I
  let seg1 = '';
  let seg2 = '';
  const randBytes = crypto.randomBytes(8);
  for (let i = 0; i < 4; i++) {
    seg1 += chars[randBytes[i] % chars.length];
    seg2 += chars[randBytes[i + 4] % chars.length];
  }
  return `GHK-${seg1}-${seg2}`;
}

/**
 * Generate a signed HMAC token (JSON payload + base64 + HMAC signature)
 */
function createToken(payload, expiresInHours = 72) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);
  const data = { ...payload, exp };

  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const encodedHeader = encode(header);
  const encodedPayload = encode(data);

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode an HMAC token
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    return null; // Invalid signature
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateHouseholdId,
  createToken,
  verifyToken
};

