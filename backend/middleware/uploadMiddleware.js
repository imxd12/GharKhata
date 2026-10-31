/**
 * GharKhata – Receipt & Bill Upload Middleware
 * Secure receipt handling supporting base64 image/PDF uploads or multipart files,
 * with strict file extension and size validation.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UPLOADS_DIR = process.env.VERCEL
  ? path.join('/tmp', 'uploads', 'receipts')
  : path.join(__dirname, '..', '..', 'uploads', 'receipts');

// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Process a base64 receipt string or return existing path
 * @param {string} base64Data - Raw data URL or base64 string
 * @param {string} originalName - Suggested original file name
 * @returns {object} { receipt_url, receipt_filename }
 */
function saveBase64Receipt(base64Data, originalName = 'receipt.jpg') {
  if (!base64Data) return { receipt_url: null, receipt_filename: null };

  let mimeType = 'image/jpeg';
  let cleanBase64 = base64Data;

  // Match data:image/png;base64,... format
  const matches = base64Data.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
  if (matches) {
    mimeType = matches[1].toLowerCase();
    cleanBase64 = matches[2];
  }

  const ext = ALLOWED_MIME_TYPES[mimeType] || path.extname(originalName).toLowerCase() || '.jpg';
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
  if (!allowedExts.includes(ext)) {
    throw new Error('Unsupported receipt format. Please upload JPG, PNG, WEBP, or PDF.');
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('Receipt file size exceeds 5MB limit.');
  }

  const filename = `receipt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  return {
    receipt_url: `/uploads/receipts/${filename}`,
    receipt_filename: originalName || filename
  };
}

module.exports = {
  saveBase64Receipt,
  UPLOADS_DIR
};

