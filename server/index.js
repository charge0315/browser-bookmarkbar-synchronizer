import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { getBookmarks, saveBookmarks, rollbackBookmarks, BROWSER_PATHS } from './utils/path-finder.js';
import { summarizeTitle, organizeBookmarksList, organizeSubCategories } from './utils/gemini.js';
import {
  backupBrowserPreferences,
  cleanupBrowserPreferenceBackups,
  closeBrowsers,
  fixBrowserPreferences,
  restartBrowsers,
  restoreBrowserPreferences,
  updateBrowserSyncSettings
} from './utils/browser-manager.js';
import progressEmitter, { emitProgress } from './utils/event-emitter.js';

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const PRE_RESTART_DELAY_MS = 1000;
const SYNC_SETTLE_DELAY_MS = 20000;

let activeSaveJob = null;
let lastSaveJobState = {
  status: 'idle',
  message: '保存ジョブはまだ実行されていません。',
  updatedAt: new Date().toISOString()
};

/**
 * ループバックアドレスかどうかを判定します。
 *
 * 意図: ローカル専用ツールの API を外部ネットワークへ露出させないためです。
 *
 * @param {string} remoteAddress - 接続元IP
 * @returns {boolean} ループバックなら true
 */
const isLoopbackAddress = (remoteAddress = '') => {
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
};

/**
 * ループバック由来の Origin だけを許可します。
 *
 * 意図: 同一端末上のローカルUIからの呼び出しに限定し、任意サイトからの操作を防ぐためです。
 *
 * @param {string | undefined} origin - Origin ヘッダ
 * @returns {boolean} 許可する場合 true
 */
const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch (error) {
    return false;
  }
};

/**
 * 指定時間待機します。
 *
 * 意図: ブラウザ再起動と設定反映の境目をサーバー側で一元管理するためです。
 *
 * @param {number} ms - 待機時間
 * @returns {Promise<void>} 待機Promise
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 対象ブラウザ一覧を確定します。
 *
 * 意図: 保存対象が未定義のキーを含んでいても、下位のファイル操作が安全に進むようにするためです。
 *
 * @param {Record<string, Object>} bookmarksDict - 保存対象辞書
 * @returns {string[]} 保存対象ブラウザ一覧
 */
const getTargetBrowsers = (bookmarksDict) => {
  return Object.keys(bookmarksDict || {}).filter(browser => BROWSER_PATHS[browser] && bookmarksDict[browser]);
};

/**
 * 保存ジョブの状態を更新します。
 *
 * 意図: 再起動後に UI が最後の成功/失敗を把握できるようにするためです。
 *
 * @param {'idle' | 'running' | 'success' | 'error'} status - 状態
 * @param {string} message - 状態メッセージ
 * @param {string | null} error - エラー内容
 */
const setSaveJobState = (status, message, error = null) => {
  lastSaveJobState = {
    status,
    message,
    error,
    updatedAt: new Date().toISOString()
  };
};

/**
 * 保存シーケンス全体をバックグラウンドジョブとして実行します。
 *
 * 意図: レスポンス返却後もサーバー側で責任を持って完走・復旧できるようにするためです。
 *
 * @param {Record<string, Object>} bookmarksDict - 保存対象辞書
 */
const runSaveAllRebootSequence = async (bookmarksDict) => {
  const targetBrowsers = getTargetBrowsers(bookmarksDict);
  const savedBrowsers = [];

  if (targetBrowsers.length === 0) {
    throw new Error('保存対象のブラウザが見つかりません。');
  }

  setSaveJobState('running', '保存シーケンスを実行中です。');

  try {
    emitProgress('保存シーケンスを開始します。ブラウザを終了中...', 'info');
    await closeBrowsers(targetBrowsers);
    await sleep(PRE_RESTART_DELAY_MS);

    emitProgress('元の同期設定を退避しています...', 'info');
    await backupBrowserPreferences(targetBrowsers);

    emitProgress('同期重複防止のため、ブラウザの同期設定を一時的にOFFにします...', 'info');
    await updateBrowserSyncSettings(false, targetBrowsers);

    emitProgress('新しいブックマーク構造を書き込み中...', 'info');
    for (const browser of targetBrowsers) {
      saveBookmarks(browser, bookmarksDict[browser]);
      savedBrowsers.push(browser);
    }

    emitProgress('同期OFFの状態でブラウザを再起動し、ローカル変更を定着させます...', 'info');
    await restartBrowsers(targetBrowsers, { openDashboard: true });

    emitProgress('ローカル変更の定着を待機中...', 'info');
    await sleep(SYNC_SETTLE_DELAY_MS);

    emitProgress('元の同期設定へ戻すため、ブラウザを再度終了します...', 'info');
    await closeBrowsers(targetBrowsers);
    await sleep(PRE_RESTART_DELAY_MS);

    emitProgress('退避していた同期設定を復元しています...', 'info');
    await restoreBrowserPreferences(targetBrowsers);
    await fixBrowserPreferences(targetBrowsers);

    emitProgress('元の同期設定でブラウザを再起動します...', 'info');
    await restartBrowsers(targetBrowsers, { openDashboard: true });
    cleanupBrowserPreferenceBackups(targetBrowsers);

    setSaveJobState('success', '保存と同期設定の復元が完了しました。');
    emitProgress('保存と同期設定の復元が完了しました。', 'success');
  } catch (error) {
    console.error('Error in save-all-reboot job:', error);
    emitProgress('保存シーケンスで問題が発生したため、元の状態への復旧を試みます...', 'error');

    for (const browser of savedBrowsers.reverse()) {
      try {
        rollbackBookmarks(browser);
      } catch (rollbackError) {
        console.error(`Rollback failed for ${browser}:`, rollbackError);
      }
    }

    try {
      await restoreBrowserPreferences(targetBrowsers);
    } catch (restoreError) {
      console.error('Preference restore failed, fallback to sync enable:', restoreError);
      try {
        await updateBrowserSyncSettings(true, targetBrowsers);
      } catch (syncError) {
        console.error('Failed to re-enable sync settings:', syncError);
      }
    }

    try {
      await fixBrowserPreferences(targetBrowsers);
    } catch (fixError) {
      console.error('Failed to normalize browser preferences:', fixError);
    }

    try {
      await restartBrowsers(targetBrowsers, { openDashboard: true });
    } catch (restartError) {
      console.error('Failed to restart browsers after rollback:', restartError);
    }

    cleanupBrowserPreferenceBackups(targetBrowsers);
    setSaveJobState('error', `保存シーケンスに失敗しました: ${error.message}`, error.message);
    emitProgress(`保存シーケンスに失敗しました: ${error.message}`, 'error');
  }
};

app.use((req, res, next) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    return res.status(403).json({ error: 'Local access only' });
  }

  next();
});
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Blocked by CORS'));
  }
}));
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

app.get('/api/save-status', (req, res) => {
  res.json(lastSaveJobState);
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

  if (getTargetBrowsers(bookmarksDict).length === 0) {
    return res.status(400).json({ error: 'No supported browsers found in bookmarks dictionary' });
  }

  if (activeSaveJob) {
    return res.status(409).json({ error: 'A save sequence is already running' });
  }

  activeSaveJob = runSaveAllRebootSequence(bookmarksDict)
    .finally(() => {
      activeSaveJob = null;
    });

  res.status(202).json({ message: 'Save sequence started...' });
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
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

export default app;
