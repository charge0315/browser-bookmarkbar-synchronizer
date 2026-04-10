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

  // Backup first
  if (fs.existsSync(filePath)) {
    const backupPath = `${filePath}.bak_antigravity`;
    fs.copyFileSync(filePath, backupPath);
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};
