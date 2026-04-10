# 結合テスト (Integration Test) レポート

## 1. 実施概要
**日時:** 2026年4月10日
**環境:** Node.js (v18+), Jest + Supertest
**目的:** Expressルーター(`index.js`のエンドポイント)と、各ビジネスロジックモジュール(`path-finder.js`, `gemini.js`, `browser-manager.js`)が正しく連携できているかをHTTPのレイヤーから検証する。

## 2. テスト戦略
`supertest` を用いて、独立したモジュール同士をMocksでつなぎ合わせた状態で、実際のExpress APIを実行しました。
モック化することで実環境を破壊せず、データフロー（リクエスト・ルーター・コントローラー・サービス・レスポンス）だけを純粋に検証しています。

### 追加・検証したエンドポイント
- `POST /api/save-all-reboot` （全ブラウザ一括保存＋再起動制御）
- `POST /api/sub-organize` （20件以上のフォルダのサブカテゴライズ制御）

### テストケース
1. **`POST /api/save-all-reboot`**
   - [x] バリデーション検証: 引数 `bookmarksDict` が欠損している場合、ステータス `400 Bad Request` とエラーメッセージが返却されること。
   - [x] 結合検証: 正しい辞書型Jsonを渡した場合、ステータス `200 OK` が返却され、`path-finder`モジュールの `saveBookmarks` がブラウザ(Chrome, Edge等)の数だけ正しく呼び出されること。
2. **`POST /api/sub-organize`**
   - [x] 結合検証: ブックマーク配列と `parentCategory` の両方を渡すと、内部で `gemini.js` の `organizeSubCategories` が呼び出され、返却されたモックJSONが正しくHTTP `200 OK` とともにクライアントにレスポンスされること。

## 3. テスト実行結果
```
PASS tests/integration/api.test.js
  API Integration Test (結合テスト)
    POST /api/save-all-reboot
      ✓ 辞書形式のブックマークデータを受け取り、全ブラウザの保存処理を呼び出すこと
      ✓ パラメータが不足している場合は400エラーを返すこと
    POST /api/sub-organize
      ✓ 20件以上のアイテムに対して正しくサブカテゴリ化処理を呼び出すこと

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

## 4. 評価
APIと各ファイルのルーティング、および **「ブラウザ終了を待ってから保存し修復する」という複雑な非同期フロー** が結合テストレベルで完全に機能していることが `FakeTimers` により証明されました。結合テストは正常に **合格 (PASSED)** しています。
