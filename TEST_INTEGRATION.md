# 結合テスト

## 現在の対象

- `POST /api/save-all-reboot`
  - 保存ジョブ受付 (`202 Accepted`)
  - バックグラウンド保存シーケンスの完走
  - `/api/save-status` による完了状態の取得
- `POST /api/sub-organize`
  - 親カテゴリ付きでの AI サブカテゴリ化呼び出し

## 実行方法

```bash
cd server
npm test -- --runInBand
```

## 補足

- `supertest` とモックで Express 層の連携を検証します。
- 実際のブラウザ終了・再起動や Gemini API 通信は行いません。
