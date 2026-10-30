const express = require('express');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { app: 'node-app' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

const app = express();

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // 5xx -> error, 4xx -> warn, everything else -> info
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Keep health-check probes out of the logs
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
    // Smaller, cleaner log lines
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

app.get('/', (req, res) => {
  res.status(200).json({
    app: 'node-app',
    endpoints: [
      { method: 'GET', path: '/',        description: 'API info and available endpoints' },
      { method: 'GET', path: '/health',  description: 'Health check' },
      { method: 'GET', path: '/success', description: 'Returns a 200 success response' },
      { method: 'GET', path: '/error',   description: 'Returns a 500 error response' },
    ],
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/success', (req, res) => {
  req.log.info('success endpoint hit');
  res.status(200).json({ status: 'success', message: 'Everything is working!' });
});

app.get('/error', (req, res) => {
  req.log.error('error endpoint hit, returning 500');
  res.status(500).json({ status: 'error', message: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  req.log.warn('route not found');
  res.status(404).json({ status: 'error', message: 'Not found' });
});

// Central error handler for anything thrown in routes
app.use((err, req, res, next) => {
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'server started');
});

// Graceful shutdown (important for k8s SIGTERM)
const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    logger.info('server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});