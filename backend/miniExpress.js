/**
 * GharKhata – Lightweight Zero-Dependency HTTP & Router Core
 * Replaces Express so GharKhata runs seamlessly on Node.js without npm installation issues.
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
    this.stack = [];
  }

  use(prefix, ...handlers) {
    if (typeof prefix === 'function') {
      handlers.unshift(prefix);
      prefix = '/';
    }

    for (const h of handlers) {
      if (h instanceof MiniRouter) {
        for (const item of h.stack) {
          const combined = (prefix === '/' ? '' : prefix) + (item.path === '/' ? '' : item.path) || '/';
          const { regex, paramNames } = parseRoute(combined);
          this.stack.push({
            method: item.method,
            path: combined,
            regex: item.isMiddleware ? (combined === '/' ? null : new RegExp('^' + combined + '(/.*)?$')) : regex,
            paramNames: item.paramNames || paramNames,
            handlers: item.handlers,
            isMiddleware: item.isMiddleware,
            prefix: item.isMiddleware ? combined : null
          });
        }
      } else {
        this.stack.push({
          method: null,
          path: prefix,
          regex: prefix === '/' ? null : new RegExp('^' + prefix + '(/.*)?$'),
          handlers: [h],
          isMiddleware: true,
          prefix: prefix === '/' ? null : prefix
        });
      }
    }
    return this;
  }

  addRoute(method, routePath, ...handlers) {
    const { regex, paramNames } = parseRoute(routePath);
    this.stack.push({
      method: method.toUpperCase(),
      path: routePath,
      regex,
      paramNames,
      handlers,
      isMiddleware: false,
      prefix: null
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

  handleRequest(req, res) {
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
    req.pathname = parsedUrl.pathname || '/';
    req.path = req.pathname;
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
      if (this.writableEnded) return;
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(data));
    };

    res.send = function (data) {
      if (this.writableEnded) return;
      if (typeof data === 'object' && !Buffer.isBuffer(data)) {
        return this.json(data);
      }
      this.end(data);
    };

    res.sendFile = function (filePath) {
      if (this.writableEnded) return;
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
      // http server response handles headers on write
    };

    // 4. Parse request body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk;
        if (bodyData.length > 20 * 1024 * 1024) { // 20MB limit
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
    let stackIdx = 0;

    const next = (err) => {
      if (err) {
        console.error('Pipeline error:', err);
        if (!res.writableEnded) {
          res.status(500).json({ success: false, message: err.message || 'Internal server error' });
        }
        return;
      }

      if (res.writableEnded) return;

      if (stackIdx >= this.stack.length) {
        if (!res.writableEnded) {
          res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.path}` });
        }
        return;
      }

      const layer = this.stack[stackIdx++];

      // Case 1: Route matching (GET, POST, etc.)
      if (!layer.isMiddleware) {
        if (layer.method === req.method) {
          const match = req.pathname.match(layer.regex);
          if (match) {
            req.params = {};
            if (layer.paramNames && layer.paramNames.length > 0) {
              layer.paramNames.forEach((name, i) => {
                req.params[name] = decodeURIComponent(match[i + 1]);
              });
            }

            // Run handlers for this route in sequence
            let hIdx = 0;
            const runHandlers = () => {
              if (hIdx < layer.handlers.length && !res.writableEnded) {
                const fn = layer.handlers[hIdx++];
                try {
                  fn(req, res, (handlerErr) => {
                    if (handlerErr) next(handlerErr);
                    else runHandlers();
                  });
                } catch (e) {
                  next(e);
                }
              } else if (!res.writableEnded) {
                next();
              }
            };
            return runHandlers();
          }
        }
        // Route didn't match, continue to next layer
        return next();
      }

      // Case 2: Middleware matching
      if (layer.isMiddleware) {
        let isMatch = false;
        if (!layer.prefix || layer.prefix === '/') {
          isMatch = true;
        } else if (req.pathname === layer.prefix || req.pathname.startsWith(layer.prefix + '/')) {
          isMatch = true;
          req.subPath = req.pathname.substring(layer.prefix.length) || '/';
        }

        if (isMatch) {
          const fn = layer.handlers[0];
          try {
            fn(req, res, next);
          } catch (e) {
            next(e);
          }
          return;
        }

        // Middleware prefix didn't match, continue to next layer
        return next();
      }
    };

    next();
  }
}

function miniExpress() {
  const appInstance = new MiniApp();
  const app = function (req, res) {
    return appInstance.handleRequest(req, res);
  };
  Object.setPrototypeOf(app, appInstance);
  for (const prop of Object.getOwnPropertyNames(MiniApp.prototype)) {
    if (prop !== 'constructor' && typeof appInstance[prop] === 'function') {
      app[prop] = appInstance[prop].bind(appInstance);
    }
  }
  for (const prop of Object.getOwnPropertyNames(MiniRouter.prototype)) {
    if (prop !== 'constructor' && typeof appInstance[prop] === 'function') {
      app[prop] = appInstance[prop].bind(appInstance);
    }
  }
  for (const prop of Object.keys(appInstance)) {
    app[prop] = appInstance[prop];
  }
  app.handle = app;
  return app;
}

miniExpress.Router = function () {
  return new MiniRouter();
};

miniExpress.static = function (dirPath) {
  return (req, res, next) => {
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
