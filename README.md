# 🧠 AI Bookmark Organizer (Chrome, Edge, Brave Sync Tool)

> **Got 500+ bookmarks scattered across Chrome, Edge, and Brave? This fixes that.**  
> **Tested with 1,000+ bookmarks. Still clean.**

Stop wasting time searching bookmarks.  
Let AI clean, deduplicate, and categorize everything — instantly.

ブラウザの「ぐちゃぐちゃブックマーク」を、AIがワンクリックで完全自動整理。

[![GitHub stars](https://img.shields.io/github/stars/charge0315/browser-bookmarkbar-synchronizer?style=social)](https://github.com/charge0315/browser-bookmarkbar-synchronizer/stargazers)
![MIT License](https://img.shields.io/badge/license-MIT-green)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)
![Made with AI](https://img.shields.io/badge/AI-Gemini-blue)

👇 See it in action below

## 🎬 Demo

<img src="./docs/demo.gif" width="720" alt="demo loop: before and after AI organization" />

> **⚡ Watch AI turn chaos into structure in seconds.**  
> Before: Messy, duplicated, scattered bookmarks.  
> After: Clean, categorized, synced perfectly across Chromium browsers.

## ✨ Features

- **🤖 AI Auto Organization**  
  AI automatically cleans and categorizes bookmarks across Chrome, Edge, and Brave simultaneously.  
  （複数のブラウザのブックマークを統合し、AIが全自動で重複削除・要約・絵文字付きカテゴリ分類を実行します）

- **📂 Deep AI Categorization**  
  Smartly handles large folders (>20 items) by recursively creating sub-categories to keep your bookmark bar clean.  
  （20件以上のアイテムがある場合はAIがさらに小分類を自動生成し、階層構造で整理します）

- **🧬 Cross-Browser Merge Engine**  
  Intelligently merges bookmarks across browsers into one unified structure.  
  （単なる同期ではなく、すべてのブラウザのブックマークを統合し「一番美しい構造」に再構築します）

- **🔄 Magic Auto-Reboot & Sync**  
  No manual file handling. The tool automatically closes browsers, applies changes, fixes crash dialogs, and restarts browsers.  
  （保存時にブラウザを自動終了・上書き・再起動。強制終了時の「復元しますか」ダイアログも自動修復します）

- **🖱️ Intuitive Drag & Drop**  
  Easily manually adjust AI results across category column boards.  
  （AIの整理結果をカテゴリごとに並べ、直感的にドラッグ＆ドロップで手動微調整が可能です）

- **🔙 Integrated Rollback**  
  Made a mistake? Restore your previous bookmark state with a single click.  
  （AIによる整理結果が気に入らない場合、ボタン一つですぐに元の状態へ戻せます）

## 🤔 Why This Exists?

Managing bookmarks across multiple browsers is painful.
Duplicates, outdated links, no structure.
This tool exists to fix that — automatically.

（複数ブラウザを使っていると「あのブックマークどこだっけ？」が頻発します。手動でのマージ対応は諦め、各ブラウザのブックマークバーをAIにより一撃で統合・整理させるために開発されました。）

## 🔒 Privacy & Safety

**Your bookmarks never leave your machine — except minimal metadata for AI processing.**

- 💻 **100% Local Execution:** Edits and writes directly to local browser filesystem.
- 🛡️ **No Cloud Storage:** No bookmark data is ever stored on external databases.
- 🧠 **Minimal Context:** Only URLs and bookmark titles are sent to Gemini API.
- ♻️ **Auto-Rollback Safe Write:** Before saving, a backup (`Bookmarks.bak_antigravity`) is created. If writing fails for any reason, it will automatically roll back to prevent data corruption.
- 🛠️ **Preference Repair:** Automatically fixes browser Preferences files after sync to prevent "Restore Pages" crash dialogs.


> **⚠️ 重要な注意事項 / Warning**
> 本ツールはローカルブックマークファイルを直接上書きします。実行前に必ずブラウザ標準のブックマークマネージャー等でバックアップ（HTMLエクスポート）を取得してください。/ Always backup your bookmarks manually before letting AI override them.

## ⭐ Early Feedback

> "Finally cleaned my 800 bookmarks in seconds."  
> — Early user

## 🛠️ Tech Stack

| Category | Technology |
| --- | --- |
| **Frontend** | React, Vite, @dnd-kit/core |
| **Backend** | Node.js, Express |
| **AI Integration** | @google/generative-ai (Gemini 1.5 Flash/Pro) |

## 🚀 Getting Started

> ⚠️ **Platform Target:** The default local browser bookmark path detection is designed for **Windows OS**. For Mac/Linux, you will need to manually update paths in `server/utils/path-finder.js`.

### Prerequisites
- Node.js `v18.0` or higher
- [Gemini API Key](https://aistudio.google.com/app/apikey) (Free tier available)

### 1. Clone the Repository
```bash
git clone https://github.com/charge0315/browser-bookmarkbar-synchronizer.git
cd browser-bookmarkbar-synchronizer
```

### 2. API Setup
Create an `.env` file inside the `server/` directory and set your API key.
```bash
GEMINI_API_KEY=your_api_key_here
```

### 3. Install Dependencies
```bash
# Terminal 1: Backend
cd server
npm install
npm run dev

# Terminal 2: Frontend
cd client
npm install
npm run dev
```

### 4. Execution
Launch `http://localhost:5173`. Click the **"✨ AI全自動整理"** button!
*(The tool will automatically handle closing and restarting your browsers when you apply changes)*


## 🚧 Roadmap

- [x] Undo / History (Local Backup Manager)
- [x] Smart Auto-Reboot & Preferences repair
- [x] Recursive Sub-categorization
- [ ] Local LLM support (Offline mode)
- [ ] Smart rules (Regex-based categories without AI)


## 🤝 Contributing

We love your input! We want to make contributing to this project as easy and transparent as possible.
- **Bug Reports:** Open an issue with reproduction steps.
- **Feature Requests:** Share your ideas in the issues tab.
- **Code Contributions:** Fork the repo, create a branch, and submit a PR!

---

**If this saved you even 10 minutes, give it a ⭐**  
**It helps more people discover it 🙌**

## 📄 License
MIT © [charge0315](https://github.com/charge0315)
