import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * 開いている対象のブラウザプロセスをすべて強制終了します。
 *
 * 意図: ブラウザが起動した状態ではブックマークファイルがロックされ、
 * 書き込み時に競合や失敗が発生するリスクがあるためです。
 * 確実にファイルを安全に書き換えるため、事前にプロセスをキルします。
 */
export const closeBrowsers = async () => {
  const browserProcesses = ['chrome.exe', 'msedge.exe', 'brave.exe'];

  for (const processName of browserProcesses) {
    try {
      // Windows上でプロセスを強制終了します
      // エラーが発生しても、プロセスが存在しないだけである可能性があるため握り潰します
      await execAsync(`taskkill /IM ${processName} /F`);
    } catch (error) {
      // プロセスが存在しない場合は何もしません（正常系として扱うため）
    }
  }
};

/**
 * 必要なブラウザを再度起動し、同期アプリの確認画面を自動展開します。
 *
 * 意図: ユーザー自身がブラウザを開き直す手間を排除し、
 * シームレスに体験を継続できるように、本アプリのダッシュボードを自動で立ち上げます。
 */
export const restartBrowsers = async () => {
  try {
    // Chromeで同期アプリのメインページを自動で開きます
    await execAsync('start chrome http://localhost:5173');
  } catch (error) {
    console.error('Failed to restart the browser:', error);
  }
};

/**
 * Preferences ファイル内の設定を JSON レベルで書き換えます。
 * 
 * @param {boolean} enableSync - 同期を有効にするか無効にするか
 */
export const updateBrowserSyncSettings = (enableSync) => {
  const BROWSER_PREFS = [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data\\Default\\Preferences`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data\\Default\\Preferences`,
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Preferences`
  ];

  BROWSER_PREFS.forEach(prefPath => {
    if (fs.existsSync(prefPath)) {
      try {
        const data = fs.readFileSync(prefPath, 'utf8');
        const config = JSON.parse(data);

        // 1. 同期設定の制御
        // 意図: 再起動直後にクラウドから古いデータが降ってきて重複するのを防ぐため、
        // 一時的に同期をオフにします。
        if (config.sync) {
          config.sync.bookmarks = enableSync;
          // 全てを同期する設定がオンの場合、個別設定が無視されることがあるため調整
          if (!enableSync) {
            config.sync.keep_everything_synced = false;
          }
        }

        // 2. クラッシュ状態の解除（既存ロジックの統合）
        if (config.profile) {
          config.profile.exit_type = "Normal";
          config.profile.exited_cleanly = true;
          config.profile.was_last_shutdown_clean = true;
        }

        fs.writeFileSync(prefPath, JSON.stringify(config), 'utf8');
        console.log(`Sync settings ${enableSync ? 'enabled' : 'disabled'} for ${prefPath}`);
      } catch (err) {
        console.error(`Failed to update preferences for ${prefPath}:`, err);
      }
    }
  });
};

/**
 * 強制終了によって「正常に終了しませんでした」ダイアログが出るのを防ぐため、
 * Preferences ファイル内のクラッシュフラグを取り除きます。
 * (updateBrowserSyncSettings に統合されましたが、互換性のために維持します)
 */
export const fixBrowserPreferences = () => {
  updateBrowserSyncSettings(true); // デフォルトでは正常化
};
