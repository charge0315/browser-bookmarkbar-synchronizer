import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';
const FILE_OPERATION_RETRIES = 8;
const FILE_OPERATION_RETRY_DELAY_MS = 250;
const RETRYABLE_FILE_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const preferenceSnapshots = new Map();

const BROWSER_PROCESS_MAP = {
  chrome: 'chrome.exe',
  edge: 'msedge.exe',
  brave: 'brave.exe'
};

const BROWSER_COMMAND_MAP = {
  chrome: 'chrome',
  edge: 'msedge',
  brave: 'brave'
};

/**
 * Preferences の実パス一覧を返します。
 *
 * 意図: 各処理が同じパス定義を共有し、バックアップ・復元・更新の対象ずれを防ぐためです。
 *
 * @returns {Record<string, string>} ブラウザごとの Preferences パス
 */
const getBrowserPreferencePaths = () => ({
  chrome: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data\\Default\\Preferences`,
  edge: `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data\\Default\\Preferences`,
  brave: `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Preferences`
});

/**
 * 対象ブラウザキーを重複なく正規化します。
 *
 * 意図: 呼び出し側の都合で配列がぶれても、下位処理が安全に共通動作できるようにするためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 * @returns {string[]} 正規化済みブラウザ一覧
 */
const normalizeBrowsers = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  return [...new Set((browsers || []).filter(browser => BROWSER_PROCESS_MAP[browser]))];
};

/**
 * 指定時間待機します。
 *
 * 意図: ブラウザ終了直後の一時的なロック解除待ちを、共通処理として扱うためです。
 *
 * @param {number} ms - 待機時間
 * @returns {Promise<void>} 待機Promise
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * リトライ対象のファイルエラーかを判定します。
 *
 * 意図: ブラウザ終了直後の一時的なアクセス拒否だけを再試行し、恒久的な異常は早めに表面化させるためです。
 *
 * @param {NodeJS.ErrnoException} error - 発生したエラー
 * @returns {boolean} リトライ対象なら true
 */
const isRetryableFileError = (error) => {
  return RETRYABLE_FILE_ERROR_CODES.has(error?.code || '');
};

/**
 * ファイル操作を一定回数リトライ付きで実行します。
 *
 * 意図: ブラウザの終了完了タイミングの揺らぎで `EPERM` になるケースを吸収するためです。
 *
 * @template T
 * @param {() => T} operation - 実行する処理
 * @returns {Promise<T>} 実行結果
 */
const retryFileOperation = async (operation) => {
  let lastError = null;

  for (let attempt = 1; attempt <= FILE_OPERATION_RETRIES; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableFileError(error) || attempt === FILE_OPERATION_RETRIES) {
        throw error;
      }

      await sleep(FILE_OPERATION_RETRY_DELAY_MS);
    }
  }

  throw lastError;
};

/**
 * Preferences 内のクラッシュ関連フラグを正常終了扱いへ補正します。
 *
 * 意図: 強制終了を伴う保存フローの後でも、復帰時に「異常終了」ダイアログを極力出さないためです。
 *
 * @param {Object} config - Preferences JSON
 */
const markProfileAsClean = (config) => {
  if (!config.profile) {
    config.profile = {};
  }

  config.profile.exit_type = 'Normal';
  config.profile.exited_cleanly = true;
  config.profile.was_last_shutdown_clean = true;
};

/**
 * Preferences を読み込み、更新関数の結果を書き戻します。
 *
 * 意図: JSON パースと共通の正常化処理を一箇所に集約し、書き込みロジックの重複と漏れを防ぐためです。
 *
 * @param {string} rawData - Preferences の生文字列
 * @param {(config: Object) => void} updater - 更新処理
 * @returns {string} 更新後の JSON 文字列
 */
const serializePreferenceConfig = (rawData, updater = () => {}) => {
  const config = JSON.parse(rawData);

  updater(config);
  markProfileAsClean(config);

  return JSON.stringify(config, null, 2);
};

/**
 * Preferences を読み込み、更新関数の結果を書き戻します。
 *
 * 意図: JSON パースと共通の正常化処理を一箇所に集約し、書き込みロジックの重複と漏れを防ぐためです。
 *
 * @param {string} prefPath - Preferences ファイルパス
 * @param {(config: Object) => void} updater - 更新処理
 */
const rewritePreferenceFile = async (prefPath, updater) => {
  await retryFileOperation(() => {
    const data = fs.readFileSync(prefPath, 'utf8');
    const serialized = serializePreferenceConfig(data, updater);
    fs.writeFileSync(prefPath, serialized, 'utf8');
  });
};

/**
 * 指定ブラウザの Preferences パス一覧を返します。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 * @returns {Array<{ browser: string, prefPath: string }>} パス情報
 */
const getPreferenceTargets = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  const prefPaths = getBrowserPreferencePaths();

  return normalizeBrowsers(browsers)
    .map(browser => {
      const prefPath = prefPaths[browser];
      return {
        browser,
        prefPath
      };
    })
    .filter(target => target.prefPath);
};

/**
 * 開いている対象のブラウザプロセスをすべて強制終了します。
 *
 * 意図: ブラウザが起動した状態ではブックマークファイルがロックされ、
 * 書き込み時に競合や失敗が発生するリスクがあるためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const closeBrowsers = async (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const browser of normalizeBrowsers(browsers)) {
    const processName = BROWSER_PROCESS_MAP[browser];

    try {
      await execAsync(`taskkill /IM ${processName} /F`);
    } catch (error) {
      // プロセスが存在しない場合も正常系として扱います。
    }
  }
};

/**
 * 対象ブラウザを再起動します。
 *
 * 意図: 保存後の復帰を自動化しつつ、最低1つのブラウザでダッシュボードを再表示して
 * 保存結果を確認できるようにするためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 * @param {{ openDashboard?: boolean }} options - 再起動オプション
 */
export const restartBrowsers = async (
  browsers = Object.keys(BROWSER_COMMAND_MAP),
  options = {}
) => {
  const normalizedBrowsers = normalizeBrowsers(browsers);
  const { openDashboard = true } = options;
  const dashboardBrowser = normalizedBrowsers[0];

  for (const browser of normalizedBrowsers) {
    const browserCommand = BROWSER_COMMAND_MAP[browser];
    const shouldOpenDashboard = openDashboard && browser === dashboardBrowser;
    const command = shouldOpenDashboard
      ? `start "" ${browserCommand} ${DASHBOARD_URL}`
      : `start "" ${browserCommand}`;

    try {
      await execAsync(command);
    } catch (error) {
      console.error(`Failed to restart ${browser}:`, error);
    }
  }
};

/**
 * Preferences の退避バックアップを作成します。
 *
 * 意図: 同期設定を一時変更しても、最後にユーザー本来の設定へ安全に戻せるようにするためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const backupBrowserPreferences = async (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const { browser, prefPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(prefPath)) {
      preferenceSnapshots.delete(browser);
      continue;
    }

    const snapshot = await retryFileOperation(() => fs.readFileSync(prefPath, 'utf8'));
    preferenceSnapshots.set(browser, snapshot);
  }
};

/**
 * Preferences の退避バックアップを元に戻します。
 *
 * 意図: 一時的に変更した同期設定を、保存フロー完了後にユーザー元設定へ戻すためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const restoreBrowserPreferences = async (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const { browser, prefPath } of getPreferenceTargets(browsers)) {
    const snapshot = preferenceSnapshots.get(browser);

    if (!snapshot) {
      continue;
    }

    await retryFileOperation(() => {
      const serialized = serializePreferenceConfig(snapshot);
      fs.writeFileSync(prefPath, serialized, 'utf8');
    });
  }
};

/**
 * Preferences の退避バックアップを削除します。
 *
 * 意図: 一時ファイルを残し続けず、次回実行時の混乱を防ぐためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const cleanupBrowserPreferenceBackups = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const browser of normalizeBrowsers(browsers)) {
    preferenceSnapshots.delete(browser);
  }
};

/**
 * Preferences ファイル内の同期関連設定を JSON レベルで書き換えます。
 *
 * @param {boolean} enableSync - 同期を有効にするか無効にするか
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const updateBrowserSyncSettings = (
  enableSync,
  browsers = Object.keys(BROWSER_PROCESS_MAP)
) => {
  return Promise.all(getPreferenceTargets(browsers).map(async ({ prefPath }) => {
    if (!fs.existsSync(prefPath)) {
      return;
    }

    try {
      await rewritePreferenceFile(prefPath, (config) => {
        if (!config.sync) {
          config.sync = {};
        }

        config.sync.bookmarks = enableSync;
        config.sync.disabled = !enableSync;
        config.sync.sync_disabled = !enableSync;

        if (!enableSync) {
          config.sync.keep_everything_synced = false;
        }
      });
    } catch (error) {
      console.error(`Failed to update preferences for ${prefPath}:`, error);
      throw error;
    }
  }));
};

/**
 * Preferences 内のクラッシュ関連フラグのみを補正します。
 *
 * 意図: 元の同期設定は維持したまま、再起動時の不要なクラッシュ警告だけを抑えるためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const fixBrowserPreferences = async (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const { prefPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(prefPath)) {
      continue;
    }

    try {
      await rewritePreferenceFile(prefPath, () => {});
    } catch (error) {
      console.error(`Failed to normalize preferences for ${prefPath}:`, error);
      throw error;
    }
  }
};
