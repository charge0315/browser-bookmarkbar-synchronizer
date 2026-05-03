const fs = require('fs');
const path = require('path');
const { defineConfig } = require('@playwright/test');

/**
 * ローカルの Playwright キャッシュから Chromium 実行ファイルを探します。
 *
 * 意図: CI やローカルで毎回ブラウザを再ダウンロードせず、既存キャッシュを再利用するためです。
 *
 * @returns {string | undefined} 実行ファイルパス
 */
const findChromiumExecutable = () => {
  const browserRoot = path.join(
    process.env.USERPROFILE || '',
    'AppData',
    'Local',
    'ms-playwright'
  );

  if (!fs.existsSync(browserRoot)) {
    return undefined;
  }

  const chromiumDir = fs.readdirSync(browserRoot)
    .find(entry => entry.startsWith('chromium-'));

  if (!chromiumDir) {
    return undefined;
  }

  const executablePath = path.join(browserRoot, chromiumDir, 'chrome-win', 'chrome.exe');
  return fs.existsSync(executablePath) ? executablePath : undefined;
};

const chromiumExecutable = findChromiumExecutable();

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: chromiumExecutable
      ? { executablePath: chromiumExecutable }
      : {}
  },
  webServer: {
    command: 'npm run dev:demo:e2e --prefix client',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
