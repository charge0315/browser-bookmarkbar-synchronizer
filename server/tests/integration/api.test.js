import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('../../utils/browser-manager.js', () => ({
  backupBrowserPreferences: jest.fn(),
  cleanupBrowserPreferenceBackups: jest.fn(),
  closeBrowsers: jest.fn().mockResolvedValue(),
  fixBrowserPreferences: jest.fn(),
  restartBrowsers: jest.fn().mockResolvedValue(),
  restoreBrowserPreferences: jest.fn(),
  updateBrowserSyncSettings: jest.fn()
}));

jest.unstable_mockModule('../../utils/path-finder.js', () => ({
  saveBookmarks: jest.fn(),
  getBookmarks: jest.fn(),
  rollbackBookmarks: jest.fn(),
  BROWSER_PATHS: { chrome: 'dummy', edge: 'dummy' }
}));

jest.unstable_mockModule('../../utils/gemini.js', () => ({
  summarizeTitle: jest.fn(),
  organizeBookmarksList: jest.fn(),
  organizeSubCategories: jest.fn()
}));

const app = (await import('../../index.js')).default;
const pathFinder = await import('../../utils/path-finder.js');
const browserManager = await import('../../utils/browser-manager.js');

describe('API Integration Test (結合テスト)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/resume-sync', () => {
    it('保留中の保存がない場合は400エラーを返すこと', async () => {
      const res = await request(app)
        .post('/api/resume-sync')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('No pending sync resume operation');
    });
  });

  describe('POST /api/save-all-reboot', () => {
    it('パラメータが不足している場合は400エラーを返すこと', async () => {
      const res = await request(app)
        .post('/api/save-all-reboot')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('Missing bookmarks dictionary');
    });

    it('保存ジョブを受け付け、同期を無効化したまま確認待ち状態で停止し、resume-syncで安全に同期を再開できること', async () => {
      jest.useFakeTimers();
      const payload = {
        bookmarksDict: {
          chrome: { roots: { bookmark_bar: { children: [] } } },
          edge: { roots: { bookmark_bar: { children: [] } } }
        }
      };

      const res = await request(app)
        .post('/api/save-all-reboot')
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body.message).toContain('Save sequence started');

      await jest.runAllTimersAsync();

      // 意図: 保存直後に同期を自動再ONにすると他デバイス由来のデータで上書きされる恐れがあるため、
      // このフェーズでは同期無効化(closeBrowsers/restartBrowsers 各2回)のみ行い、復元は行わない。
      expect(browserManager.closeBrowsers).toHaveBeenCalledTimes(2);
      expect(browserManager.restartBrowsers).toHaveBeenCalledTimes(2);
      expect(browserManager.backupBrowserPreferences).toHaveBeenCalledWith(['chrome', 'edge']);
      expect(browserManager.restoreBrowserPreferences).not.toHaveBeenCalled();
      expect(browserManager.cleanupBrowserPreferenceBackups).not.toHaveBeenCalled();
      expect(browserManager.updateBrowserSyncSettings).toHaveBeenCalledWith(false, ['chrome', 'edge']);

      expect(pathFinder.saveBookmarks).toHaveBeenCalledTimes(6);

      let statusRes = await request(app).get('/api/save-status');
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('awaiting-confirmation');

      // 意図: ユーザーが内容を確認した後に明示的に呼び出すことで、初めて同期設定が復元されることを検証します。
      const resumeRes = await request(app).post('/api/resume-sync').send({});
      expect(resumeRes.status).toBe(202);
      expect(resumeRes.body.message).toContain('Resume-sync sequence started');

      await jest.runAllTimersAsync();

      expect(browserManager.restoreBrowserPreferences).toHaveBeenCalledWith(['chrome', 'edge']);
      expect(browserManager.cleanupBrowserPreferenceBackups).toHaveBeenCalledWith(['chrome', 'edge']);

      statusRes = await request(app).get('/api/save-status');
      expect(statusRes.body.status).toBe('success');

      jest.useRealTimers();
    });
  });

  describe('POST /api/sub-organize', () => {
    it('親カテゴリ付きのリクエストでサブカテゴリ化処理を呼び出すこと', async () => {
      const gemini = await import('../../utils/gemini.js');
      gemini.organizeSubCategories.mockResolvedValue([
        { name: 'test', url: 'http://test', category: '📂 テスト' }
      ]);

      const payload = {
        items: [{ title: 'hoge' }],
        parentCategory: 'IT'
      };

      const res = await request(app)
        .post('/api/sub-organize')
        .send(payload)
        .expect(200);

      expect(gemini.organizeSubCategories).toHaveBeenCalledWith(payload.items, payload.parentCategory);
      expect(res.body[0].category).toBe('📂 テスト');
    });
  });
});
