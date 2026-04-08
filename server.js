const path = require('path');

// Cache the Express app between Vercel invocations
let app;
const getApp = async () => {
  if (!app) {
    const { default: expressApp } = await import('./artifacts/api-server/dist/index.mjs');
    app = expressApp;
  }
  return app;
};

// Vercel serverless handler — exports a single async request handler
module.exports = async (req, res) => {
  const expressApp = await getApp();
  expressApp(req, res);
};
