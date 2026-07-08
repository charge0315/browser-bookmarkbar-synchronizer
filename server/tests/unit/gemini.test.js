import { jest } from '@jest/globals';

// GoogleGenerativeAI のモック
const mockResponse = {
  response: {
    text: () => JSON.stringify([
      { "category": "💻 開発", "name": "Google", "url": "https://google.com" }
    ])
  }
};

const mockModel = {
  generateContent: jest.fn(() => Promise.resolve(mockResponse))
};

jest.unstable_mockModule('@google/generative-ai', () => ({
  HarmBlockThreshold: {
    BLOCK_NONE: 'BLOCK_NONE'
  },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT'
  },
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: () => mockModel
  }))
}));

// テスト対象モジュールをインポート
const { organizeBookmarksList, mergeCategoriesToTargetCount } = await import('../../utils/gemini.js');

describe('Gemini Logic (AI整理ロジックの単体テスト)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'fake-key';
  });

  it('すべての入力アイテムが結果に含まれること (1:1マッピング)', async () => {
    const inputItems = [
      { name: 'Google', url: 'https://google.com' },
      { name: 'GitHub', url: 'https://github.com' }
    ];

    // GitHubがAIの結果から漏れているケースをシミュレート
    mockModel.generateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify([
          { "category": "💻 開発", "name": "Google", "url": "https://google.com" }
        ])
      }
    });

    const result = await organizeBookmarksList(inputItems);

    // 入力は2件、結果も補完されて2件なはず
    expect(result.length).toBe(2);
    
    const urls = result.map(r => r.url);
    expect(urls).toContain('https://google.com');
    expect(urls).toContain('https://github.com');

    // 漏れた方は「未分類」になっているはず
    const github = result.find(r => r.url === 'https://github.com');
    expect(github.category).toContain('未分類');
  });

  it('AIのリクエストが失敗（パース不能なJSON）してもアイテムを救済すること', async () => {
    const inputItems = [
      { name: 'Broken', url: 'https://broken.com' }
    ];

    mockModel.generateContent.mockResolvedValueOnce({
      response: {
        text: () => "This is not JSON!!"
      }
    });

    const result = await organizeBookmarksList(inputItems);

    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://broken.com');
    expect(result[0].category).toContain('未分類');
  });

  describe('mergeCategoriesToTargetCount()', () => {
    it('すでにカテゴリ数がtargetCount以下の場合は、変更せずにそのまま返すこと', async () => {
      const items = [
        { category: '💻 開発', name: 'Google', url: 'https://google.com' },
        { category: '🛒 ショッピング', name: 'Amazon', url: 'https://amazon.com' }
      ];
      
      const result = await mergeCategoriesToTargetCount(items, 15);
      expect(result).toEqual(items);
    });

    it('カテゴリ数がtargetCountを超える場合、AIマージを適用して指定数以下にすること', async () => {
      const items = Array.from({ length: 18 }, (_, i) => ({
        category: `📂 カテゴリ${i}`,
        name: `サイト${i}`,
        url: `https://site${i}.com`
      }));

      // mockModelの挙動をモック
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            "📂 カテゴリ0": "📁 マージカテゴリA",
            "📂 カテゴリ1": "📁 マージカテゴリA",
            "📂 カテゴリ2": "📁 マージカテゴリB",
            "📂 カテゴリ3": "📁 マージカテゴリB",
            "📂 カテゴリ4": "📁 マージカテゴリC",
            "📂 カテゴリ5": "📁 マージカテゴリC",
            "📂 カテゴリ6": "📁 マージカテゴリC",
            "📂 カテゴリ7": "📁 マージカテゴリC",
            "📂 カテゴリ8": "📁 マージカテゴリC",
            "📂 カテゴリ9": "📁 マージカテゴリC",
            "📂 カテゴリ10": "📁 マージカテゴリC",
            "📂 カテゴリ11": "📁 マージカテゴリC",
            "📂 カテゴリ12": "📁 マージカテゴリC",
            "📂 カテゴリ13": "📁 マージカテゴリC",
            "📂 カテゴリ14": "📁 マージカテゴリC",
            "📂 カテゴリ15": "📁 マージカテゴリC",
            "📂 カテゴリ16": "📁 マージカテゴリC",
            "📂 カテゴリ17": "📁 マージカテゴリC"
          })
        }
      });

      const result = await mergeCategoriesToTargetCount(items, 15);
      const uniqueCats = Array.from(new Set(result.map(r => r.category)));

      // 15以下に削減されていること
      expect(uniqueCats.length).toBeLessThanOrEqual(15);
      expect(uniqueCats).toContain("📁 マージカテゴリA");
      expect(uniqueCats).toContain("📁 マージカテゴリB");
      expect(uniqueCats).toContain("📁 マージカテゴリC");
    });

    it('AIマージが失敗（例外発生）した場合でも、フォールバック処理で15カテゴリ以下にすること', async () => {
      const items = Array.from({ length: 18 }, (_, i) => ({
        category: `📂 カテゴリ${i}`,
        name: `サイト${i}`,
        url: `https://site${i}.com`
      }));

      // 例外を発生させる
      mockModel.generateContent.mockRejectedValueOnce(new Error("AI Error"));

      const result = await mergeCategoriesToTargetCount(items, 15);
      const uniqueCats = Array.from(new Set(result.map(r => r.category)));

      expect(uniqueCats.length).toBeLessThanOrEqual(15);
    });
  });
});
