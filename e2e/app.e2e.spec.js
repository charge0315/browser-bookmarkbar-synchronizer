const { test, expect } = require('@playwright/test');

const aiResponses = {
  default: [
    { category: '💻 開発', name: 'GitHub', url: 'https://github.com' },
    { category: '💻 開発', name: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { category: '💻 開発', name: 'React Docs', url: 'https://react.dev' },
    { category: '🛒 買い物', name: 'Amazon', url: 'https://www.amazon.co.jp' },
    { category: '🛒 買い物', name: 'Rakuten', url: 'https://www.rakuten.co.jp' },
    { category: '☁️ クラウド', name: 'Azure Portal', url: 'https://portal.azure.com' },
    { category: '📘 学習', name: 'Microsoft Learn', url: 'https://learn.microsoft.com' },
    { category: '🔎 検索', name: 'Brave Search', url: 'https://search.brave.com' },
    { category: '📰 ニュース', name: 'TechCrunch', url: 'https://techcrunch.com' }
  ],
  functional: [
    { category: '🧰 作業', name: 'GitHub', url: 'https://github.com' },
    { category: '🧰 作業', name: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { category: '📚 学習', name: 'React Docs', url: 'https://react.dev' },
    { category: '🛒 買い物', name: 'Amazon', url: 'https://www.amazon.co.jp' },
    { category: '🛒 買い物', name: 'Rakuten', url: 'https://www.rakuten.co.jp' },
    { category: '🧰 作業', name: 'Azure Portal', url: 'https://portal.azure.com' },
    { category: '📚 学習', name: 'Microsoft Learn', url: 'https://learn.microsoft.com' },
    { category: '🔎 検索', name: 'Brave Search', url: 'https://search.brave.com' },
    { category: '📰 ニュース', name: 'TechCrunch', url: 'https://techcrunch.com' }
  ],
  topic: [
    { category: '🌐 Web開発', name: 'GitHub', url: 'https://github.com' },
    { category: '🌐 Web開発', name: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { category: '🌐 Web開発', name: 'React Docs', url: 'https://react.dev' },
    { category: '🛒 EC', name: 'Amazon', url: 'https://www.amazon.co.jp' },
    { category: '🛒 EC', name: 'Rakuten', url: 'https://www.rakuten.co.jp' },
    { category: '☁️ クラウド', name: 'Azure Portal', url: 'https://portal.azure.com' },
    { category: '📘 ドキュメント', name: 'Microsoft Learn', url: 'https://learn.microsoft.com' },
    { category: '🔎 検索', name: 'Brave Search', url: 'https://search.brave.com' },
    { category: '📰 メディア', name: 'TechCrunch', url: 'https://techcrunch.com' }
  ]
};

/**
 * 指定カラムのルート要素を返します。
 *
 * 意図: テスト側で日本語ラベルを直接使いながら、DOM 構造変更の影響を受けにくくするためです。
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} columnKey - カラムキー
 * @returns {import('@playwright/test').Locator} カラム locator
 */
const getColumn = (page, columnKey) => {
  return page.locator(`[data-testid="bookmark-column"][data-column-key="${columnKey}"]`);
};

/**
 * 指定タイトルのカード要素を返します。
 *
 * @param {import('@playwright/test').Locator} column - カラム locator
 * @param {string} title - ブックマーク名
 * @returns {import('@playwright/test').Locator} アイテム locator
 */
const getItemCard = (column, title) => {
  return column.locator(`[data-testid="bookmark-item"][data-bookmark-title="${title}"]`);
};

test.describe('ブックマーク整理 E2E', () => {
  test('AI分類候補の切り替えができる', async ({ page }) => {
    await page.route('**/api/ai-organize', async route => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aiResponses[body.perspective] || aiResponses.default)
      });
    });

    await page.goto('/');
    await expect(page.locator('[data-testid="bookmark-item"][data-bookmark-title="GitHub"]').first()).toBeVisible();

    await page.getByTestId('ai-organize-button').click();

    await expect(page.getByTestId('pattern-card-default')).toBeVisible();
    await expect(getColumn(page, '💻 開発')).toBeVisible();

    await page.getByTestId('pattern-card-topic').click();
    await expect(getColumn(page, '🌐 Web開発')).toBeVisible();
    await expect(getColumn(page, '💻 開発')).toHaveCount(0);
  });

  test('プレビュー編集結果を保存リクエストへ反映できる', async ({ page }) => {
    let capturedSavePayload = null;

    page.on('dialog', dialog => dialog.accept());

    await page.route('**/api/ai-organize', async route => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aiResponses[body.perspective] || aiResponses.default)
      });
    });

    await page.route('**/api/save-all-reboot', async route => {
      capturedSavePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Save sequence started...' })
      });
    });

    await page.goto('/');
    await page.getByTestId('ai-organize-button').click();
    await page.getByTestId('pattern-card-functional').click();

    const studyColumn = getColumn(page, '📚 学習');
    const workColumn = getColumn(page, '🧰 作業');
    const reactCard = getItemCard(studyColumn, 'React Docs');
    const githubCard = getItemCard(workColumn, 'GitHub');

    await expect(reactCard).toBeVisible();
    await reactCard.dragTo(githubCard);
    await expect(workColumn.getByText('React Docs')).toBeVisible();

    await page.getByTestId('preview-save-button').click();
    await expect(page.getByTestId('save-status-banner')).toContainText('保存シーケンス実行中');

    expect(capturedSavePayload).not.toBeNull();

    const bookmarkBarFolders = capturedSavePayload.bookmarksDict.chrome.roots.bookmark_bar.children;
    const workFolder = bookmarkBarFolders.find(folder => folder.name === '🧰 作業');
    const studyFolder = bookmarkBarFolders.find(folder => folder.name === '📚 学習');

    expect(workFolder).toBeTruthy();
    expect(studyFolder).toBeTruthy();
    expect(workFolder.children.some(item => item.name === 'React Docs')).toBe(true);
    expect(studyFolder.children.some(item => item.name === 'React Docs')).toBe(false);
  });
});
