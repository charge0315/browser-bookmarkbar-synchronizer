/**
 * @fileoverview Google Gemini APIを利用したブックマーク解析・整理ユーティリティ
 * 
 * 意図: 自然言語処理を用いて、ブックマークのタイトルの要約や、
 * ユーザーが指定した観点に基づく最適なカテゴリ分類を自動化するためです。
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import dotenv from 'dotenv';
import { emitProgress } from './event-emitter.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
// 安全フィルタを最低レベルに設定し、コンテンツがブロックされないようにします。
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const model = genAI.getGenerativeModel({ 
  model: "gemini-flash-latest",
  safetySettings
});

/**
 * ブックマークのタイトルを短い日本語ラベルに要約します。
 * 
 * 意図: 元のタイトルが長すぎてUIを圧迫する場合に、AIで意味を抽出しつつ
 * コンパクトな表示名に変換するためです。
 *
 * @param {string} title - 元のタイトル
 * @returns {Promise<string>} 要約されたラベル
 */
export const summarizeTitle = async (title) => {
  if (!process.env.GEMINI_API_KEY) {
    // APIキーがない場合のフォールバック: 単純な切り出し
    return title.length > 10 ? title.substring(0, 10) + '...' : title;
  }

  try {
    const prompt = `以下のウェブサイトのタイトルを、2〜3語程度の短いラベル（日本語）に要約してください。
    余計な説明は省き、ラベルのみを出力してください。
    タイトル: "${title}"`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Gemini Error:", error);
    return title.substring(0, 10); // エラー時のフォールバック
  }
};

/**
 * 大量のブックマークアイテムを指定された観点でカテゴリ分類します。
 * 
 * 意図: 複数のブラウザから集まった膨大な未整理ブックマークを、
 * AIに一括でコンテキスト解析させ、使いやすいフォルダ構造へと再構築するためです。
 * 大量のデータを扱うため、チャンク分割して処理を行います。
 *
 * @param {Array<Object>} items - 分類対象のアイテム
 * @param {string} perspectiveType - 分類の観点 (default, functional, topic, alternative)
 * @returns {Promise<Array<Object>>} 分類結果の配列
 */
export const organizeBookmarksList = async (items, perspectiveType = "default") => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI APIキーが設定されていません。.envファイルを確認してください。');
  }

  const CHUNK_SIZE = 80;
  
  const PERSPECTIVES = {
    "default": "ブックマークを最適なカテゴリに分類してください。",
    "functional": "「買い物」「技術調査」「娯楽」といった、ユーザーの『行動・目的』ベースで機能的に分類してください。",
    "topic": "ウェブサイトの『トピック・主題』に基づいて、専門的なカテゴリ（例：テクノロジー、経済、ライフスタイル）で分類してください。",
    "alternative": "先ほどとは全く異なる、よりユニークで斬新な観点（例：「読むべき重要度順」「利用頻度」「エモーショナルな分類」など）で再分類してください。"
  };

  const perspective = PERSPECTIVES[perspectiveType] || PERSPECTIVES["default"];

  let allOrganized = [];
  let existingCategories = new Set(["📦 その他"]);
  const totalChunks = Math.ceil(items.length / CHUNK_SIZE);

  emitProgress(`AI整理を開始します (全${items.length}件 / ${totalChunks}チャンク)`, 'info');

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const currentChunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const existingCatsStr = Array.from(existingCategories).join(', ');

    emitProgress(`チャンク ${currentChunkIndex}/${totalChunks} を分析中...`, 'info');

    const prompt = `以下のブックマークのリスト（JSON形式）を分析し、全自動で整理してください。
要件:
1. ブックマーク名（name）を一目で内容がわかるように、短く分かりやすく簡略化してください。
2. ${perspective}
3. 各カテゴリ名（category）は必ず「絵文字＋半角スペース＋カテゴリ名」の形式にしてください（例: "💻 プログラミング", "🛒 ショッピング"）。
4. 既に分類されている以下のカテゴリに合致するものは、できるだけ同じカテゴリ名（絵文字も完全一致）を使用してください。合致しない場合のみ新規作成してください: [${existingCatsStr}]
5. 入力されたブックマークは、内容に関わらず「一つも漏らさず」必ず出力に含めてください。アダルト、ギャンブル、ショッピングなど、いかなるジャンルであっても除外は厳禁です。
6. 出力は以下のスキーマに従ったJSON配列のみを返却してください。バッククォートやMarkdown表記（\`\`\`json など）は絶対に含めず、純粋なJSON文字列だけを出力してください。
[
  { "category": "カテゴリ名", "name": "簡略化された名前", "url": "URL" }
]

入力ブックマーク:
${JSON.stringify(chunk)}`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text().trim();
      
      // JSONパースのクリーンアップ（Markdown装飾の除去）
      if (text.startsWith('\`\`\`json')) {
        text = text.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
      } else if (text.startsWith('\`\`\`')) {
        text = text.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
      }

      const parsedChunk = JSON.parse(text);
      
      // 前のチャンクで生成されたカテゴリ名を学習し、整合性を保つ
      parsedChunk.forEach(item => {
        if (item.category) existingCategories.add(item.category);
      });

      allOrganized = allOrganized.concat(parsedChunk);
      emitProgress(`チャンク ${currentChunkIndex} の分析が完了しました`, 'success');

      // 無料枠APIのレート制限を考慮した待機
      if (i + CHUNK_SIZE < items.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error("Gemini Organize Error chunking at index " + i + ":", error);
      // AIの解析が失敗した場合でも、URLを消失させないための救済措置
      const salvage = chunk.map(item => ({
        category: "📦 未分類 (要確認)",
        name: item.name,
        url: item.url
      }));
      allOrganized = allOrganized.concat(salvage);
    }
  }

  // 最終チェック: 入力の全URLが結果に含まれているか（AIによる間引きを許容しない）
  const outputUrls = new Set(allOrganized.map(it => it.url));

  items.forEach(inputItem => {
    if (!outputUrls.has(inputItem.url)) {
      console.warn(`Item missing after AI organization, salvaging: ${inputItem.url}`);
      allOrganized.push({
        category: "📦 未分類 (要確認)",
        name: inputItem.name,
        url: inputItem.url
      });
    }
  });

  return allOrganized;
};

/**
 * 20件以上の巨大なカテゴリ内で、さらに別観点のサブカテゴリへ再分類します。
 *
 * 意図: 親カテゴリが膨大になった場合、階層構造に分けて整理するためです。
 * AIにより3～5個程度のサブカテゴリを自動生成します。
 *
 * @param {Array<Object>} items - サブカテゴリ化するアイテム一覧
 * @param {string} parentCategory - 親カテゴリ名
 * @returns {Promise<Array<Object>>} サブカテゴリ名を付与したアイテムの配列
 */
export const organizeSubCategories = async (items, parentCategory) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI APIキーが設定されていません。');
  }

  emitProgress(`巨大フォルダ「${parentCategory}」(${items.length}件) をさらに細分類中...`, 'info');

  // 統合されたモデル設定を使用
  const prompt = `以下のブックマークリストは、すべて「${parentCategory}」というカテゴリに属していますが、数が多いためさらに細分化（サブカテゴリ化）したいです。これらの要素を3～5つ程度の適切なサブカテゴリに分類してJSONで返してください。

要件:
1. "category"キーには"サブカテゴリ名（絵文字1つ＋簡潔な名称）"を設定してください。
2. 入力されたブックマークは、内容に関わらず必ずすべて出力に含めてください。
3. JSONを返すだけにしてください。バッククオートや不要な文を含めないでください。

出力スキーマ:
[
    {
      "name": "もとの名前",
      "url": "もとのURL",
      "category": "サブカテゴリ名（絵文字1つ＋簡潔な名称）"
    }
]

データ:
${JSON.stringify(items, null, 2)}`;

  try {
    const result = await model.generateContent(prompt);
    let text = (await result.response).text().trim();
    if (text.startsWith('\`\`\`json')) {
      text = text.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
    } else if (text.startsWith('\`\`\`')) {
      text = text.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
    }
    
    const res = JSON.parse(text);
    emitProgress(`「${parentCategory}」の細分類が完了しました`, 'success');
    return res;
  } catch (error) {
    console.error("Gemini Error:", error);
    emitProgress(`「${parentCategory}」の細分類に失敗しました`, 'warning');
    throw new Error('AIが不正なJSONを出力しました。');
  }
};
