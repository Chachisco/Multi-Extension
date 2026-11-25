// tests/smoke.spec.js
const { test, expect } = require('./fixtures');

test('Extensão carrega e interceta um PDF remoto', async ({ page, extensionId }) => {
  // 1. Confirma que o ID da extensão foi detetado
  expect(extensionId).toBeTruthy();
  console.log('Extensão carregada com ID:', extensionId);

  // 2. Abre um PDF público de teste (podes trocar pelo caminho de um PDF local teu)
  await page.goto('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');

  // 3. Verifica se o URL mudou para a página da tua extensão ou se o teu viewer assumiu o controlo
  // (Ajusta o seletor abaixo para o ID/classe principal do teu viewer, ex: '#viewerContainer' ou '#pdf-canvas')
  await page.waitForTimeout(1500);
  
  const currentUrl = page.url();
  console.log('URL atual:', currentUrl);
  
  // Se a tua extensão redireciona para chrome-extension://<ID>/viewer.html...
  expect(currentUrl).toContain(extensionId);
});