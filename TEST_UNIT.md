# 単体テスト

## 現在の対象

- `server/tests/unit/browser-manager.test.js`
  - ブラウザ終了コマンドの発行
  - ブラウザ再起動コマンドの発行
  - Preferences のバックアップ・復元・クリーンアップ
  - 同期設定の一時無効化
- `server/tests/unit/gemini.test.js`
  - AI 応答から要素が欠落した場合の救済
  - JSON パース不能時の未分類フォールバック

## 実行方法

```bash
cd server
npm test -- --runInBand
```

## 補足

- いずれもモックベースの単体テストです。
- 実ブラウザや実ファイルは操作しません。
