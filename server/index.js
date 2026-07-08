/**
 * @fileoverview ブックマーク同期サーバーのメインエントリーポイント
 * 
 * 意図: ブラウザ間のブックマーク同期、AIによる自動整理、およびクライアントへの進捗通知を統括するAPIサーバーを提供するためです。
 */

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
 * 同期再開待ちの情報
 *
 * 意図: クラウド同期の自動再ONによる上書き事故を防ぐため、保存シーケンス完了後は
 * 同期を無効化したまま停止し、ユーザーが内容を確認して明示的に再開するまで
 * 対象ブラウザ一覧を保持しておくためです。
 */
let pendingResync = null;

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
 * 空のブックマーク構造を生成します。
 * 
 * 意図: 同期前にブラウザのブックマークを完全にクリアするために使用します。
 *
 * @returns {Object} 空のブックマーク構造
 */
const makeEmptyBookmarks = () => ({
  version: 1,
  roots: {
    bookmark_bar: {
      children: [],
      date_added: "0",
      date_modified: "0",
      id: "1",
      name: "Bookmark Bar",
      type: "folder"
    },
    other: {
      children: [],
      date_added: "0",
      date_modified: "0",
      id: "2",
      name: "Other Bookmarks",
      type: "folder"
    },
    synced: {
      children: [],
      date_added: "0",
      date_modified: "0",
      id: "3",
      name: "Mobile Bookmarks",
      type: "folder"
    }
  }
});

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

    // 【フェーズ1: ブックマークのクリア＆アカウント同期】
    emitProgress('すべてのブラウザ의 ブックマークを削除（クリア）して同期準備中...', 'info');
    for (const browser of targetBrowsers) {
      saveBookmarks(browser, makeEmptyBookmarks());
    }

    emitProgress('空のブックマークをアカウントで同期させるため、ブラウザを再起動中...', 'info');
    await restartBrowsers(targetBrowsers, { openDashboard: false });

    // アカウントの同期時間を待機 (30秒間)
    const CLOUD_SYNC_WAIT_MS = 30000;
    emitProgress('アカウントでの空ブックマークの同期完了を待機しています（30秒）...', 'info');
    await sleep(CLOUD_SYNC_WAIT_MS);

    emitProgress('同期が完了しました。整理されたブックマークを反映するため、ブラウザを再度終了します...', 'info');
    await closeBrowsers(targetBrowsers);
    await sleep(PRE_RESTART_DELAY_MS);

    emitProgress('同期重複防止のため、ブラウザの同期設定を一時的にOFFにします...', 'info');
    await updateBrowserSyncSettings(false, targetBrowsers);

    // 【フェーズ2: さらにクリアしてから反映】
    emitProgress('安全のため、さらにもう一度クリアしてから、整理されたブックマーク構造を書き込み中...', 'info');
    for (const browser of targetBrowsers) {
      saveBookmarks(browser, makeEmptyBookmarks()); // さらにクリア
      saveBookmarks(browser, bookmarksDict[browser]); // 反映
      savedBrowsers.push(browser);
    }

    emitProgress('同期OFFの状態でブラウザを再起動し、ローカル変更を定着させます...', 'info');
    await restartBrowsers(targetBrowsers, { openDashboard: true });

    emitProgress('ローカル変更の定着を待機中...', 'info');
    await sleep(SYNC_SETTLE_DELAY_MS);

    // 意図: ここで同期を自動的に再ONにすると、他デバイスに残る古いクラウド側データとの
    // マージにより、今書き込んだ内容が上書きされてしまう事故が起こり得ます。
    // そのため同期は無効のまま停止し、ユーザーが内容を確認したうえで
    // /api/resume-sync を明示的に呼び出すまで再開しません。
    pendingResync = { targetBrowsers };
    setSaveJobState(
      'awaiting-confirmation',
      'ローカルへの保存が完了しました。ブックマークバーの内容を確認し、問題なければ「同期を再開する」を実行してください（同期は意図的に無効化されたままです）。'
    );
    emitProgress('ローカルへの保存が完了しました。内容を確認後、同期の再開を実行してください。', 'success');
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
    pendingResync = null;
    setSaveJobState('error', `保存シーケンスに失敗しました: ${error.message}`, error.message);
    emitProgress(`保存シーケンスに失敗しました: ${error.message}`, 'error');
  }
};

/**
 * ユーザーの確認後に、クラウド同期を安全に再開するシーケンスです。
 *
 * 意図: 保存直後の自動再ONによる上書き事故を避けるため、ユーザーが
 * ブックマークバーの内容を確認してから明示的に呼び出すことを前提とした処理です。
 */
const runResumeSyncSequence = async () => {
  if (!pendingResync) {
    setSaveJobState('error', '再開できる保留中の同期処理がありません。', 'No pending resync');
    return;
  }

  const { targetBrowsers } = pendingResync;
  setSaveJobState('running', '同期設定を復元しています。');

  try {
    emitProgress('同期設定を復元するため、ブラウザを終了します...', 'info');
    await closeBrowsers(targetBrowsers);
    await sleep(PRE_RESTART_DELAY_MS);

    emitProgress('退避していた同期設定を復元しています...', 'info');
    await restoreBrowserPreferences(targetBrowsers);
    await fixBrowserPreferences(targetBrowsers);

    emitProgress('元の同期設定でブラウザを再起動します...', 'info');
    await restartBrowsers(targetBrowsers, { openDashboard: true });
    cleanupBrowserPreferenceBackups(targetBrowsers);

    pendingResync = null;
    setSaveJobState('success', '保存と同期設定の復元が完了しました。');
    emitProgress('保存と同期設定の復元が完了しました。', 'success');
  } catch (error) {
    console.error('Error in resume-sync job:', error);
    setSaveJobState('error', `同期の再開に失敗しました: ${error.message}`, error.message);
    emitProgress(`同期の再開に失敗しました: ${error.message}`, 'error');
  }
};

/**
 * 接続元の制限設定
 * 
 * 意図: このツールはローカルPC内での動作を前提としているため、外部からの不正なAPI操作を物理的に遮断するためです。
 */
app.use((req, res, next) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    return res.status(403).json({ error: 'Local access only' });
  }

  next();
});

/**
 * CORS設定
 * 
 * 意図: ローカル環境のダッシュボード（Web UI）からの通信のみを安全に許可するためです。
 */
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Blocked by CORS'));
  }
}));

/**
 * ミドルウェア設定
 * 
 * 意図: 大容量のブックマークデータ（JSON）を扱えるようにし、開発時のデバッグログを標準出力するためです。
 */
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

/**
 * ブックマーク取得エンドポイント
 * 
 * 意図: サポートされている全ブラウザから現在のブックマーク構造を読み込み、UIに表示可能な形式で返却するためです。
 */
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

/**
 * 保存ジョブ状態取得エンドポイント
 * 
 * 意図: バックグラウンドで進行している「保存・再起動シーケンス」の進捗や最終結果をUI側で定期的に確認（ポーリング）できるようにするためです。
 */
app.get('/api/save-status', (req, res) => {
  res.json(lastSaveJobState);
});

/**
 * 単一ブラウザ保存エンドポイント
 * 
 * 意図: 特定のブラウザに対して即座にブックマークを反映させたい場合に使用します。
 */
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

/**
 * 同期再開エンドポイント
 *
 * 意図: 保存シーケンス完了後、意図的に無効化したままにしているクラウド同期を、
 * ユーザーが内容確認を終えたタイミングで明示的に再開させるためです。
 */
app.post('/api/resume-sync', async (req, res) => {
  if (activeSaveJob) {
    return res.status(409).json({ error: 'A save sequence is already running' });
  }

  if (!pendingResync) {
    return res.status(400).json({ error: 'No pending sync resume operation' });
  }

  activeSaveJob = runResumeSyncSequence()
    .finally(() => {
      activeSaveJob = null;
    });

  res.status(202).json({ message: 'Resume-sync sequence started...' });
});

/**
 * ロールバック実行エンドポイント
 * 
 * 意図: 書き込み前に自動作成されたバックアップから、以前の正常な状態へブックマークを復元するためです。
 */
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

/**
 * タイトル要約エンドポイント
 * 
 * 意図: ブックマークのタイトルが長すぎる場合に、AIを用いて意味を損なわずに短縮し、UIをすっきりさせるためです。
 */
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

/**
 * AIによる自動整理（メイン）エンドポイント
 * 
 * 意図: 散らばったブックマークをAIが分析し、指定された視点（仕事・趣味など）に基づいた理想的なカテゴリ構造を提案するためです。
 */
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
