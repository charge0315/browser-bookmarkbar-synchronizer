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
 * 強制終了によって「正常に終了しませんでした」ダイアログが出るのを防ぐため、
 * Preferences ファイル内のクラッシュフラグを取り除きます。
 */
export const fixBrowserPreferences = () => {
  const BROWSER_PREFS = [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data\\Default\\Preferences`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data\\Default\\Preferences`,
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Preferences`
  ];

  BROWSER_PREFS.forEach(prefPath => {
    if (fs.existsSync(prefPath)) {
      try {
        const data = fs.readFileSync(prefPath, 'utf8');
        // 1. クラッシュ状態の解除
        let fixedData = data.replace(/"exit_type":"Crashed"/g, '"exit_type":"Normal"');
        fixedData = fixedData.replace(/"exit_state":"Crashed"/g, '"exit_state":"Normal"');
        fixedData = fixedData.replace(/"exited_cleanly":false/g, '"exited_cleanly":true');
        
        // 2. 特殊なフラグの削除 (もしあれば)
        // 意図: バックグラウンドでの強制終了に伴うエラー通知を最小限にします
        fixedData = fixedData.replace(/"was_last_shutdown_clean":false/g, '"was_last_shutdown_clean":true');
        
        fs.writeFileSync(prefPath, fixedData, 'utf8');
      } catch (err) {
        console.error(`Failed to fix preferences for ${prefPath}:`, err);
      }
    }
  });
};
