import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';
const PREFERENCES_BACKUP_SUFFIX = '.bak_antigravity_prefs';

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
 * @param {string} prefPath - Preferences ファイルパス
 * @param {(config: Object) => void} updater - 更新処理
 */
const rewritePreferenceFile = (prefPath, updater) => {
  const data = fs.readFileSync(prefPath, 'utf8');
  const config = JSON.parse(data);

  updater(config);
  markProfileAsClean(config);

  fs.writeFileSync(prefPath, JSON.stringify(config, null, 2), 'utf8');
};

/**
 * 指定ブラウザの Preferences パス一覧を返します。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 * @returns {Array<{ browser: string, prefPath: string, backupPath: string }>} パス情報
 */
const getPreferenceTargets = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  const prefPaths = getBrowserPreferencePaths();

  return normalizeBrowsers(browsers)
    .map(browser => {
      const prefPath = prefPaths[browser];
      return {
        browser,
        prefPath,
        backupPath: `${prefPath}${PREFERENCES_BACKUP_SUFFIX}`
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
export const backupBrowserPreferences = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const { prefPath, backupPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(prefPath)) {
      continue;
    }

    fs.copyFileSync(prefPath, backupPath);
  }
};

/**
 * Preferences の退避バックアップを元に戻します。
 *
 * 意図: 一時的に変更した同期設定を、保存フロー完了後にユーザー元設定へ戻すためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const restoreBrowserPreferences = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const { prefPath, backupPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(backupPath)) {
      continue;
    }

    fs.copyFileSync(backupPath, prefPath);
    rewritePreferenceFile(prefPath, () => {});
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
  for (const { backupPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(backupPath)) {
      continue;
    }

    try {
      fs.unlinkSync(backupPath);
    } catch (error) {
      console.warn(`Failed to clean preference backup: ${backupPath}`, error);
    }
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
  for (const { prefPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(prefPath)) {
      continue;
    }

    try {
      rewritePreferenceFile(prefPath, (config) => {
        if (!config.sync) {
          config.sync = {};
        }

        config.sync.bookmarks = enableSync;

        if (!enableSync) {
          config.sync.keep_everything_synced = false;
        }
      });
    } catch (error) {
      console.error(`Failed to update preferences for ${prefPath}:`, error);
      throw error;
    }
  }
};

/**
 * Preferences 内のクラッシュ関連フラグのみを補正します。
 *
 * 意図: 元の同期設定は維持したまま、再起動時の不要なクラッシュ警告だけを抑えるためです。
 *
 * @param {string[]} browsers - 対象ブラウザ一覧
 */
export const fixBrowserPreferences = (browsers = Object.keys(BROWSER_PROCESS_MAP)) => {
  for (const { prefPath } of getPreferenceTargets(browsers)) {
    if (!fs.existsSync(prefPath)) {
      continue;
    }

    try {
      rewritePreferenceFile(prefPath, () => {});
    } catch (error) {
      console.error(`Failed to normalize preferences for ${prefPath}:`, error);
      throw error;
    }
  }
};
