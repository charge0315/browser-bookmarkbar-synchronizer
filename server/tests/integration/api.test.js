import { jest } from '@jest/globals';
import request from 'supertest';

// Mocks
jest.unstable_mockModule('../../utils/browser-manager.js', () => ({
  closeBrowsers: jest.fn().mockResolvedValue(),
  restartBrowsers: jest.fn().mockResolvedValue(),
  fixBrowserPreferences: jest.fn()
}));

jest.unstable_mockModule('../../utils/path-finder.js', () => ({
  saveBookmarks: jest.fn(),
  getBookmarks: jest.fn(),
  rollbackBookmarks: jest.fn(),
  BROWSER_PATHS: { chrome: 'dummy' }
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

  describe('POST /api/save-all-reboot', () => {
    it('辞書形式のブックマークデータを受け取り、全ブラウザの保存処理を呼び出すこと', async () => {
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
      
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('rebooting...');
      
      // 非同期のsetTimeoutを強制的に進めます
      jest.runAllTimers();
      
      // タイマー終了後に呼び出されているかチェック
      expect(pathFinder.saveBookmarks).toHaveBeenCalledTimes(2);
      expect(pathFinder.saveBookmarks).toHaveBeenCalledWith('chrome', payload.bookmarksDict.chrome);
      expect(pathFinder.saveBookmarks).toHaveBeenCalledWith('edge', payload.bookmarksDict.edge);
      
      jest.useRealTimers();
    });

    it('パラメータが不足している場合は400エラーを返すこと', async () => {
      const res = await request(app)
        .post('/api/save-all-reboot')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('Missing bookmarks dictionary');
    });
  });

  describe('POST /api/sub-organize', () => {
    it('20件以上のアイテムに対して正しくサブカテゴリ化処理を呼び出すこと', async () => {
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
