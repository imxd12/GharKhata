/**
 * GharKhata – Lightweight Zero-Dependency HTTP & Router Core
 * Replaces Express so GharKhata runs instantly on any Node.js 18+ system without npm install.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8'
};

class MiniRouter {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(...args) {
    if (args.length === 1 && typeof args[0] === 'function') {
      this.middlewares.push(args[0]);
    } else if (args.length >= 2 && typeof args[0] === 'string') {
      const prefix = args[0];
      const handler = args[1];
      if (handler instanceof MiniRouter) {
        handler.routes.forEach(r => {
          this.routes.push({
            method: r.method,
            pathRegex: pathToRegex(prefix + (r.path === '/' ? '' : r.path)),
            paramNames: r.paramNames,
            handlers: [...this.middlewares, ...handler.middlewares, ...r.handlers]
          });
        });
      } else if (typeof handler === 'function') {
        this.middlewares.push((req, res, next) => {
          if (req.pathname === prefix || req.pathname.startsWith(prefix + '/')) {
            const oldSubPath = req.subPath;
            req.subPath = req.pathname.substring(prefix.length) || '/';
            handler(req, res, () => {
              req.subPath = oldSubPath;
              next();
            });
          } else {
            next();
          }
        });
      }
    }
    return this;
  }

  addRoute(method, routePath, ...handlers) {
    const { regex, paramNames } = parseRoute(routePath);
    this.routes.push({
      method: method.toUpperCase(),
      path: routePath,
      pathRegex: regex,
      paramNames,
      handlers
    });
  }

  get(path, ...handlers) { this.addRoute('GET', path, ...handlers); return this; }
  post(path, ...handlers) { this.addRoute('POST', path, ...handlers); return this; }
  put(path, ...handlers) { this.addRoute('PUT', path, ...handlers); return this; }
  patch(path, ...handlers) { this.addRoute('PATCH', path, ...handlers); return this; }
  delete(path, ...handlers) { this.addRoute('DELETE', path, ...handlers); return this; }
}

function parseRoute(routePath) {
  const paramNames = [];
  const clean = routePath.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${clean}/?$`);
  return { regex, paramNames };
}

function pathToRegex(routePath) {
  const paramNames = [];
  const clean = routePath.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return new RegExp(`^${clean}/?$`);
}

class MiniApp extends MiniRouter {
  constructor() {
    super();
  }

  listen(port, callback) {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
    return server.listen(port, callback);
  }

  async handleRequest(req, res) {
    // 1. CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // 2. Parse URL and query
    const parsedUrl = url.parse(req.url, true);
    req.pathname = parsedUrl.pathname;
    req.query = parsedUrl.query || {};
    req.params = {};
    req.subPath = undefined;

    // 3. Response helpers
    res.statusCode = 200;
    res.status = function (code) {
      this.statusCode = code;
      return this;
    };

    res.json = function (data) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(data));
    };

    res.send = function (data) {
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
        return this.json(data);
      }
      this.end(data);
    };

    res.sendFile = function (filePath) {
      if (!fs.existsSync(filePath)) {
        this.status(404).json({ success: false, message: 'File not found' });
        return;
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        this.status(404).json({ success: false, message: 'Not a file' });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      this.setHeader('Content-Type', mime);
      this.setHeader('Content-Length', stat.size);
      fs.createReadStream(filePath).pipe(this);
    };

    res.flushHeaders = function () {
      // http handles flushing on write
    };

    // 4. Parse body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk;
        if (bodyData.length > 15 * 1024 * 1024) { // 15MB limit
          req.destroy();
        }
      });

      req.on('end', () => {
        if (bodyData) {
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              req.body = JSON.parse(bodyData);
            } catch (e) {
              req.body = {};
            }
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const parsedForm = new URLSearchParams(bodyData);
            req.body = Object.fromEntries(parsedForm.entries());
          } else {
            req.body = bodyData;
          }
        } else {
          req.body = {};
        }
        this.dispatch(req, res);
      });
    } else {
      req.body = {};
      this.dispatch(req, res);
    }
  }

  dispatch(req, res) {
    let matchedRoute = null;
    let params = {};

    for (const r of this.routes) {
      if (r.method === req.method) {
        const match = req.pathname.match(r.pathRegex);
        if (match) {
          matchedRoute = r;
          if (r.paramNames && r.paramNames.length > 0) {
            r.paramNames.forEach((name, i) => {
              params[name] = decodeURIComponent(match[i + 1]);
            });
          }
          break;
        }
      }
    }

    req.params = params;

    const chain = [];
    chain.push(...this.middlewares);

    if (matchedRoute) {
      chain.push(...matchedRoute.handlers);
    }

    let idx = 0;
    const next = (err) => {
      if (err) {
        console.error('Middleware error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
      }

      if (idx < chain.length) {
        const fn = chain[idx++];
        try {
          fn(req, res, next);
        } catch (e) {
          next(e);
        }
      } else {
        if (!res.writableEnded) {
          res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.pathname}` });
        }
      }
    };

    next();
  }
}

function miniExpress() {
  return new MiniApp();
}

miniExpress.Router = function () {
  return new MiniRouter();
};

miniExpress.static = function (dirPath) {
  return (req, res, next) => {
    // If mounted via app.use(prefix, ...), req.subPath is available
    const relPath = req.subPath !== undefined ? req.subPath : req.pathname;
    const cleanRelPath = decodeURIComponent(relPath).replace(/^\/+/, '');
    const fullPath = path.isAbsolute(cleanRelPath) ? cleanRelPath : path.join(dirPath, cleanRelPath);

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      res.sendFile(fullPath);
    } else {
      next();
    }
  };
};

miniExpress.json = function () {
  return (req, res, next) => next();
};

miniExpress.urlencoded = function () {
  return (req, res, next) => next();
};

module.exports = miniExpress;
