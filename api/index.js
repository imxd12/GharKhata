// Vercel Serverless Function entry point
const app = require('../backend/server');

module.exports = (req, res) => {
  try {
    // 1. Normalize request URL on Vercel
    if (req.headers['x-matched-path'] && req.headers['x-matched-path'].startsWith('/api/')) {
      const queryStr = req.url && req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      req.url = req.headers['x-matched-path'] + queryStr;
    } else if (req.headers['x-forwarded-uri'] && req.headers['x-forwarded-uri'].startsWith('/api/')) {
      req.url = req.headers['x-forwarded-uri'];
    } else if (req.url && (req.url.startsWith('/api/index.js') || req.url.startsWith('/api/index') || req.url === '/api')) {
      const match = req.url.match(/[?&]path=([^&]+)/);
      if (match) {
        const decodedPath = decodeURIComponent(match[1]);
        req.url = '/api/' + decodedPath;
      }
    }

    return app(req, res);
  } catch (err) {
    console.error('Vercel serverless entrypoint error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, message: 'Serverless invocation error: ' + err.message }));
    }
  }
};


