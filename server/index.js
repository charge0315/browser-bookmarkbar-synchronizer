import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { getBookmarks, saveBookmarks, rollbackBookmarks, BROWSER_PATHS } from './utils/path-finder.js';
import { summarizeTitle, organizeBookmarksList, organizeSubCategories } from './utils/gemini.js';
import { closeBrowsers, restartBrowsers, fixBrowserPreferences, updateBrowserSyncSettings } from './utils/browser-manager.js';
import progressEmitter, { emitProgress } from './utils/event-emitter.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

/**
 * Server-Sent Events (SSE) エンドポイント
 * 
 * 意図: クライアントへAIの進捗状況などをリアルタイムにプッシュするためです。
 */
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  progressEmitter.on('progress', onProgress);

  req.on('close', () => {
    progressEmitter.off('progress', onProgress);
  });
});

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
    // 意図: ブラウザ起動中に同期が走って重複するのを防ぐため、
    // 「同期OFFで起動して定着させる」→「同期ONに戻す」のダブル再起動シーケンスを行います。
    emitProgress('保存シーケンスを開始します。ブラウザを終了中...', 'info');
    await closeBrowsers();

    setTimeout(async () => {
      // 1. 同期設定を一時的に無効化
      emitProgress('同期重複防止のため、ブラウザの同期設定を一時的にOFFにします...', 'info');
      updateBrowserSyncSettings(false);

      // 2. ブックマーク情報の書き込み
      emitProgress('新しいブックマーク構造を書き込み中...', 'info');
      Object.keys(bookmarksDict).forEach(browser => {
        saveBookmarks(browser, bookmarksDict[browser]);
      });

      // 3. ブラウザを同期OFFの状態で一度起動（インポートを確定させる）
      emitProgress('同期OFFの状態で一度ブラウザを起動し、データを確定させます...', 'info');
      await restartBrowsers();

      // 4. 数秒待機してから、同期をONに戻して最終起動
      setTimeout(async () => {
        emitProgress('同期設定をONに戻すための最終処理中...', 'info');
        await closeBrowsers();
        
        setTimeout(async () => {
          updateBrowserSyncSettings(true);
          emitProgress('完了！同期をONにしてブラウザを最終起動します。', 'success');
          await restartBrowsers();
        }, 1000);

      }, 8000); // 8秒間、同期OFFの状態でインポートさせる
    }, 1000);

    res.json({ message: 'Double-restart sync protection sequence started...' });
  } catch (error) {
    console.error(`Error in save-all-reboot:`, error);
    emitProgress('保存シーケンス中にエラーが発生しました。', 'error');
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
