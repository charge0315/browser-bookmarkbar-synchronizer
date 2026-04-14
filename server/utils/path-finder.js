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
      // 同期用IDやバージョン情報を削除
      delete node.sync_transaction_version;
      delete node.meta_info;
      // GUIDを削除すると完全に新規扱いになるが、重複を避けるために一旦IDは残す。
      // ただし、もし同期エンジンがGUIDを厳格に見ている場合は削除が必要。
      // ここでは、再同期を促すために削除します。
      delete node.guid;
      
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
