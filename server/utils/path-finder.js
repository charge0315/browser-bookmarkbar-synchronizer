import path from 'path';
import fs from 'fs';

const getLocalLow = () => process.env.LOCALAPPDATA;

export const BROWSER_PATHS = {
  chrome: path.join(getLocalLow(), 'Google/Chrome/User Data/Default/Bookmarks'),
  edge: path.join(getLocalLow(), 'Microsoft/Edge/User Data/Default/Bookmarks'),
  brave: path.join(getLocalLow(), 'BraveSoftware/Brave-Browser/User Data/Default/Bookmarks'),
};

export const getBookmarks = (browser) => {
  const filePath = BROWSER_PATHS[browser];
  if (!filePath) throw new Error(`Unknown browser: ${browser}`);
  
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  }
  return null;
};

export const saveBookmarks = (browser, data) => {
  const filePath = BROWSER_PATHS[browser];
  if (!filePath) throw new Error(`Unknown browser: ${browser}`);

  let backupCreated = false;
  const backupPath = `${filePath}.bak_antigravity`;
  const browserBakPath = `${filePath}.bak`;

  // 1. まず現在のバックアップをとる
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
    backupCreated = true;
  }

  // 2. ブラウザ自身のバックアップ（.bak）を削除
  // 意図: ブラウザが不整合を検知して古いバックアップから復元するのを防ぐため
  if (fs.existsSync(browserBakPath)) {
    try {
      fs.unlinkSync(browserBakPath);
    } catch (e) {
      console.warn(`Failed to delete browser backup for ${browser}:`, e);
    }
  }

  try {
    // 3. データのクリーンアップ
    // 意図: チェックサムを削除（ブラウザに再計算させる）し、
    // 各ノードの同期用メタデータを削除して「新規ローカルデータ」として扱わせる
    const cleanData = JSON.parse(JSON.stringify(data));
    
    // トップレベルのチェックサムを削除
    if (cleanData.checksum) {
      delete cleanData.checksum;
    }

    const stripSyncInfo = (node) => {
      // 意図: 同期エンジンが「古いデータ」と「新しいデータ」を衝突させないように調整します。
      
      // 同期用トランザクションバージョンとメタ情報を削除（これによりローカルの変更を優先させる）
      delete node.sync_transaction_version;
      delete node.meta_info;

      // GUIDの扱い: 
      // 既存のGUIDがある場合は、それを維持することでブラウザに「同一アイテムの移動」と認識させます。
      // GUIDがない（AIが新しく作ったフォルダ等）場合、ブラウザが自動生成するのに任せます。
      // かつては delete node.guid していましたが、これが重複（再ダウンロード）の主因となるため、
      // 既存のものは残す方針に変更します。
      
      if (node.children) {
        node.children.forEach(stripSyncInfo);
      }
    };

    if (cleanData.roots) {
      Object.keys(cleanData.roots).forEach(rootKey => {
        if (cleanData.roots[rootKey].children) {
          cleanData.roots[rootKey].children.forEach(stripSyncInfo);
        }
      });
    }

    fs.writeFileSync(filePath, JSON.stringify(cleanData, null, 2), 'utf8');
  } catch (error) {
    // Rollback if an error occurs during writing
    if (backupCreated) {
      console.error(`Write failed for ${browser}, rolling back...`);
      fs.copyFileSync(backupPath, filePath);
    }
    throw new Error(`Failed to save bookmarks. Rolled back to original state: ${error.message}`);
  }
};

export const rollbackBookmarks = (browser) => {
  const filePath = BROWSER_PATHS[browser];
  if (!filePath) throw new Error(`Unknown browser: ${browser}`);

  const backupPath = `${filePath}.bak_antigravity`;
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, filePath);
    return true;
  }
  return false;
};
