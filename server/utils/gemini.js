import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

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
