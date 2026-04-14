import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { getBookmarks, saveBookmarks, rollbackBookmarks, BROWSER_PATHS } from './utils/path-finder.js';
import { summarizeTitle, organizeBookmarksList, organizeSubCategories } from './utils/gemini.js';
import { closeBrowsers, restartBrowsers, fixBrowserPreferences } from './utils/browser-manager.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

app.get('/api/bookmarks', (req, res) => {
  try {
    const results = {};
    for (const browser of Object.keys(BROWSER_PATHS)) {
      results[browser] = getBookmarks(browser);
    }
    res.json(results);
  } catch (error) {
    console.error('Error fetching bookmarks:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/save', (req, res) => {
  const { browser, data } = req.body;
  if (!browser || !data) {
    return res.status(400).json({ error: 'Missing browser or data' });
  }

  try {
    saveBookmarks(browser, data);
    res.json({ message: `Successfully saved bookmarks for ${browser}` });
  } catch (error) {
    console.error(`Error saving bookmarks for ${browser}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 送信された全てのブラウザ情報を一括で保存し、ブラウザを再起動する統合エンドポイント。
 *
 * 意図: クライアント側から複数回通信させると、ブラウザ終了によって通信が落ちる問題があるため、
 * サーバ側で一気に保存し、安全にプロセスをキルしてリロードさせるためです。
 */
app.post('/api/save-all-reboot', async (req, res) => {
  const { bookmarksDict } = req.body;
  if (!bookmarksDict) {
    return res.status(400).json({ error: 'Missing bookmarks dictionary' });
  }

  try {
    // 意図: ブラウザが起動したままだとファイルロックがかかったり、
    // 終了時にメモリ上の古いデータで上書きされたりするため、まず最初にブラウザを終了させます。
    await closeBrowsers();

    // 終了を確実にするための短い待機
    setTimeout(async () => {
      // 1. ブックマーク情報の書き込み
      Object.keys(bookmarksDict).forEach(browser => {
        saveBookmarks(browser, bookmarksDict[browser]);
      });

      // 2. クラッシュダイアログ防止のためのPreferences修正
      fixBrowserPreferences();

      // 3. ブラウザをクリーンな状態で再起動
      setTimeout(async () => {
        await restartBrowsers();
      }, 500);
    }, 1000);

    res.json({ message: 'Browsers closed, bookmarks updated, and rebooting...' });
  } catch (error) {
    console.error(`Error in save-all-reboot:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rollback', (req, res) => {
  const { browser } = req.body;
  if (!browser) {
    return res.status(400).json({ error: 'Missing browser parameter' });
  }

  try {
    const success = rollbackBookmarks(browser);
    if (success) {
      res.json({ message: `Successfully rolled back bookmarks for ${browser}` });
    } else {
      res.status(404).json({ error: `No backup found for ${browser}` });
    }
  } catch (error) {
    console.error(`Error rolling back bookmarks for ${browser}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/summarize', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Missing title' });

  try {
    const summary = await summarizeTitle(title);
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai-organize', async (req, res) => {
  try {
    const { items, perspective } = req.body;
    const result = await organizeBookmarksList(items, perspective || 'default');
    res.json(result);
  } catch (error) {
    console.error('AI Organize error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 送信されたブックマークリストを、特定の親カテゴリ配下でさらに細分類します。
 * 
 * 意図: 20件以上の巨大なフォルダができた際に、AIを用いてサブカテゴリを自動生成するためです。
 */
app.post('/api/sub-organize', async (req, res) => {
  const { items, parentCategory } = req.body;
  if (!items || !Array.isArray(items) || !parentCategory) {
    return res.status(400).json({ error: 'Missing logic parameters' });
  }

  try {
    const subOrganized = await organizeSubCategories(items, parentCategory);
    res.json(subOrganized);
  } catch (error) {
    console.error(`Error in sub organize for ${parentCategory}:`, error);
    res.status(500).json({ error: error.message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
