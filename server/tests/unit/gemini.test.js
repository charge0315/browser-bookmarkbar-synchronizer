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
const { organizeBookmarksList } = await import('../../utils/gemini.js');

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
});
