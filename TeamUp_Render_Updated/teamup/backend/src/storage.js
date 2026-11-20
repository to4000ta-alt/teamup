const Minio = require('minio');
const crypto = require('crypto');

const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_USER,
  secretKey: process.env.MINIO_PASSWORD,
});
const bucket = process.env.MINIO_BUCKET || 'teamup';

async function init() {
  if (!process.env.MINIO_ENDPOINT || !process.env.MINIO_USER || !process.env.MINIO_PASSWORD) {
    console.warn('Object storage is not configured. File uploads will remain unavailable until MINIO_* settings are added.');
    return false;
  }
  for (let i = 0; i < 20; i++) {
    try {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
      console.log(`Object storage bucket "${bucket}" is ready.`);
      return true;
    } catch (error) {
      if (i === 19) console.error('MinIO not reachable; file uploads will fail:', error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return false;
}

async function put(file) {
  const safeName = String(file.originalname || 'upload').replace(/[^\w.-]/g, '_').slice(0, 100);
  const key = `${crypto.randomUUID()}-${safeName}`;
  await client.putObject(bucket, key, file.buffer, file.size, {
    'Content-Type': file.mimetype || 'application/octet-stream',
  });
  return key;
}

async function stream(key, res, { inline = false } = {}) {
  if (!/^[a-f0-9-]{36}-[\w.-]{1,100}$/i.test(key)) {
    const error = new Error('File not found.');
    error.status = 404;
    throw error;
  }
  const stat = await client.statObject(bucket, key);
  const contentType = stat.metaData['content-type'] || 'application/octet-stream';
  const canInline = inline && /^image\/(png|jpeg|gif|webp)$/.test(contentType);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${canInline ? 'inline' : 'attachment'}; filename="download"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  const object = await client.getObject(bucket, key);
  object.on('error', error => {
    if (!res.headersSent) res.status(500).json({ error: 'Unable to read file.' });
    else res.destroy(error);
  });
  object.pipe(res);
}

module.exports = { init, put, stream };
