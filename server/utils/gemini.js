import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

export const summarizeTitle = async (title) => {
  if (!process.env.GEMINI_API_KEY) {
    // Fallback if no key: slice and dice
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
    return title.substring(0, 10); // Fallback
  }
};

export const organizeBookmarksList = async (items, alternative = false) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI APIキーが設定されていません。.envファイルを確認してください。');
  }

  const CHUNK_SIZE = 80; // バッチサイズ。大きすぎると出力トークン超過、小さすぎるとAPI制限に引っかかる
  let perspective = "ブックマークを最適なカテゴリに分類してください。";
  if (alternative) {
    perspective = "先ほどとは全く異なる、よりユニークで斬新な観点（例：「読むべき重要度順」「タスク・行動ベース」「利用頻度」など）で再分類してください。";
  }

  let allOrganized = [];
  let existingCategories = new Set(["📦 その他"]);

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const existingCatsStr = Array.from(existingCategories).join(', ');

    const prompt = `以下のブックマークのリスト（JSON形式）を分析し、全自動で整理してください。
要件:
1. ブックマーク名（name）を一目で内容がわかるように、短く分かりやすく簡略化してください。
2. ${perspective}
3. 各カテゴリ名（category）は必ず「絵文字＋半角スペース＋カテゴリ名」の形式にしてください（例: "💻 プログラミング", "🛒 ショッピング"）。
4. 既に分類されている以下のカテゴリに合致するものは、できるだけ同じカテゴリ名（絵文字も完全一致）を使用してください。合致しない場合のみ新規作成してください: [${existingCatsStr}]
5. 出力は以下のスキーマに従ったJSON配列のみを返却してください。バッククォートやMarkdown表記（\`\`\`json など）は絶対に含めず、純粋なJSON文字列だけを出力してください。
[
  { "category": "カテゴリ名", "name": "簡略化された名前", "url": "URL" }
]

入力ブックマーク:
${JSON.stringify(chunk)}`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text().trim();
      
      // JSONパースのクリーンアップ
      if (text.startsWith('\`\`\`json')) {
        text = text.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
      } else if (text.startsWith('\`\`\`')) {
        text = text.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
      }

      const parsedChunk = JSON.parse(text);
      
      // 学習したカテゴリを次のチャンクに引き継ぐ
      parsedChunk.forEach(item => {
        if (item.category) existingCategories.add(item.category);
      });

      allOrganized = allOrganized.concat(parsedChunk);

      // Free Tier API制限を回避するためのウェイト
      if (i + CHUNK_SIZE < items.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error("Gemini Organize Error chunking at index " + i + ":", error);
      throw new Error('AIによる整理中にエラーが発生しました（一部チャンク）: ' + error.message);
    }
  }

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

  const prompt = `以下のブックマークリストは、すべて「${parentCategory}」というカテゴリに属していますが、数が多いためさらに細分化（サブカテゴリ化）したいです。これらの要素を3～5つ程度の適切なサブカテゴリに分類してJSONで返してください。

要件:
1. "category"キーには"サブカテゴリ名（絵文字1つ＋簡潔な名称）"を設定してください。
2. JSONを返すだけにしてください。バッククオートや不要な文を含めないでください。

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
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini Error:", error);
    throw new Error('AIが不正なJSONを出力しました。');
  }
};
