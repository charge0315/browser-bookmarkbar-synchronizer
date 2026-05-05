/**
 * @fileoverview ブラウザのブックマークファイル（Bookmarks）のパス特定およびI/Oユーティリティ
 * 
 * 意図: 各ブラウザ固有のプロファイルディレクトリ内にあるブックマークファイルを特定し、
 * 同期エンジンとの競合を避けながら安全に読み書きを行うためです。
 */

import path from 'path';
import fs from 'fs';

const getLocalLow = () => process.env.LOCALAPPDATA;

export const BROWSER_PATHS = {
  chrome: path.join(getLocalLow(), 'Google/Chrome/User Data/Default/Bookmarks'),
  edge: path.join(getLocalLow(), 'Microsoft/Edge/User Data/Default/Bookmarks'),
  brave: path.join(getLocalLow(), 'BraveSoftware/Brave-Browser/User Data/Default/Bookmarks'),
};

/**
 * 指定されたブラウザのブックマークデータを取得します。
 * 
 * 意図: ブラウザごとの JSON 構造をそのままメモリ上に読み込み、
 * 後のマージや AI 解析のためのソースデータとするためです。
 *
 * @param {string} browser - ブラウザ名 (chrome, edge, brave)
 * @returns {Object|null} ブックマークデータ
 */
export const getBookmarks = (browser) => {
  const filePath = BROWSER_PATHS[browser];
  if (!filePath) throw new Error(`Unknown browser: ${browser}`);
  
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  }
  return null;
};

/**
 * ブックマークデータを特定のブラウザに書き込みます。
 * 
 * 意図: AI 整理や手動編集後のデータを、ブラウザが正常に認識し、
 * かつクラウド同期サーバーが「新しい変更」として受け入れるようにデータを正規化して保存するためです。
 *
 * @param {string} browser - ブラウザ名
 * @param {Object} data - 保存するブックマークデータ
 */
export const saveBookmarks = (browser, data) => {
  const filePath = BROWSER_PATHS[browser];
  if (!filePath) throw new Error(`Unknown browser: ${browser}`);

  let backupCreated = false;
  const backupPath = `${filePath}.bak_antigravity`;
  const browserBakPath = `${filePath}.bak`;

  // 1. 万が一の失敗に備え、書き込み前に現在の状態を退避
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
    backupCreated = true;
  }

  // 2. ブラウザ自身が作成した古いバックアップ（.bak）を明示的に削除
  // 意図: 書き込み後のファイルが不正とみなされた場合、ブラウザが古いバックアップから勝手に復元するのを防ぐためです。
  if (fs.existsSync(browserBakPath)) {
    try {
      fs.unlinkSync(browserBakPath);
    } catch (e) {
      console.warn(`Failed to delete browser backup for ${browser}:`, e);
    }
  }

  try {
    // 3. データのクレンジングと同期メタデータの処理
    // 意図: チェックサムを削除してブラウザに再計算を強制し、
    // 同期用の古いメタデータを剥ぎ取ることで、クラウド同期上の「競合」ではなく「新規変更」として扱わせるためです。
    const cleanData = JSON.parse(JSON.stringify(data));
    
    // トップレベルのチェックサムを削除（書き込み後の整合性エラーを防ぐ）
    if (cleanData.checksum) {
      delete cleanData.checksum;
    }

    const stripSyncInfo = (node) => {
      // 意図: 同期エンジンが「過去のサーバーデータ」との不整合を検知して巻き戻すのを防ぎます。
      
      // 同期用トランザクションバージョンとメタ情報を削除
      delete node.sync_transaction_version;
      delete node.meta_info;

      // GUID は既存のものを維持します。
      // 意図: GUID を削除すると、ブラウザが「全く新しいアイテム」とみなし、
      // クラウドに残っている旧アイテムが重複してダウンロードされるのを避けるためです。
      
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
    // 書き込みエラー発生時は即座にロールバック
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
