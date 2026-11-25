// tests/fixtures.js
const { test: base, chromium } = require('@playwright/test');
const path = require('path');

// Aponta para a pasta raiz onde está o teu manifest.json
const pathToExtension = path.resolve(__dirname, '..');

const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // Espera pelo Service Worker (background.js) do Manifest V3 para extrair o ID
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

module.exports = { test, expect: test.expect };