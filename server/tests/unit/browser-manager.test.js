import { jest } from '@jest/globals';

const mockExec = jest.fn((command, callback) => callback(null, { stdout: '', stderr: '' }));
const mockFiles = new Map();

const mockFs = {
  existsSync: jest.fn((filePath) => mockFiles.has(filePath)),
  readFileSync: jest.fn((filePath) => mockFiles.get(filePath)),
  writeFileSync: jest.fn((filePath, contents) => {
    mockFiles.set(filePath, contents);
  }),
  copyFileSync: jest.fn((fromPath, toPath) => {
    mockFiles.set(toPath, mockFiles.get(fromPath));
  }),
  unlinkSync: jest.fn((filePath) => {
    mockFiles.delete(filePath);
  })
};

jest.unstable_mockModule('child_process', () => ({
  exec: mockExec
}));

jest.unstable_mockModule('fs', () => ({
  default: mockFs
}));

const {
  backupBrowserPreferences,
  cleanupBrowserPreferenceBackups,
  closeBrowsers,
  restartBrowsers,
  restoreBrowserPreferences,
  updateBrowserSyncSettings
} = await import('../../utils/browser-manager.js');

describe('Browser Manager Utility (単体テスト)', () => {
  const chromePrefPath = 'C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Preferences';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFiles.clear();
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
  });

  describe('closeBrowsers()', () => {
    it('三種類のブラウザに対して強制終了コマンドを発行すること', async () => {
      await closeBrowsers();

      expect(mockExec).toHaveBeenCalledTimes(3);
      expect(mockExec.mock.calls[0][0]).toContain('taskkill /IM chrome.exe /F');
      expect(mockExec.mock.calls[1][0]).toContain('taskkill /IM msedge.exe /F');
      expect(mockExec.mock.calls[2][0]).toContain('taskkill /IM brave.exe /F');
    });

    it('プロセスが存在しないエラーでも継続すること', async () => {
      mockExec.mockImplementation((command, callback) => callback(new Error('Process not found'), { stdout: '', stderr: '' }));

      await expect(closeBrowsers()).resolves.toBeUndefined();
    });
  });

  describe('restartBrowsers()', () => {
    it('最初のブラウザではダッシュボードを開き、以降は通常起動すること', async () => {
      await restartBrowsers(['edge', 'brave'], { openDashboard: true });

      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec.mock.calls[0][0]).toContain('start "" msedge http://localhost:5173');
      expect(mockExec.mock.calls[1][0]).toContain('start "" brave');
    });
  });

  describe('Preferences backup and restore', () => {
    it('同期設定のバックアップと復元を行い、復元時に終了状態も正常化すること', async () => {
      mockFiles.set(chromePrefPath, JSON.stringify({
        sync: {
          bookmarks: true,
          keep_everything_synced: true
        },
        profile: {
          exit_type: 'Crashed'
        }
      }));

      await backupBrowserPreferences(['chrome']);

      await updateBrowserSyncSettings(false, ['chrome']);
      const disabledConfig = JSON.parse(mockFiles.get(chromePrefPath));
      expect(disabledConfig.sync.bookmarks).toBe(false);
      expect(disabledConfig.sync.disabled).toBe(true);
      expect(disabledConfig.sync.sync_disabled).toBe(true);
      expect(disabledConfig.sync.keep_everything_synced).toBe(false);
      expect(disabledConfig.profile.exit_type).toBe('Normal');

      await restoreBrowserPreferences(['chrome']);
      const restoredConfig = JSON.parse(mockFiles.get(chromePrefPath));
      expect(restoredConfig.sync.bookmarks).toBe(true);
      expect(restoredConfig.sync.keep_everything_synced).toBe(true);
      expect(restoredConfig.profile.exit_type).toBe('Normal');
    });

    it('クリーンアップ後は保持していたスナップショットを使わずに復元をスキップすること', async () => {
      mockFiles.set(chromePrefPath, JSON.stringify({
        sync: {
          bookmarks: true,
          keep_everything_synced: true
        },
        profile: {
          exit_type: 'Normal'
        }
      }));

      await backupBrowserPreferences(['chrome']);
      cleanupBrowserPreferenceBackups(['chrome']);
      mockFiles.set(chromePrefPath, '{"sync":{"bookmarks":false},"profile":{"exit_type":"Crashed"}}');
      await restoreBrowserPreferences(['chrome']);

      const currentConfig = JSON.parse(mockFiles.get(chromePrefPath));
      expect(currentConfig.sync.bookmarks).toBe(false);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
