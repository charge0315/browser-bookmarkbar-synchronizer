# Product Specification: ZenSync (ゼン・シンク)

> Generated from brief: "ブラウザのブックマーク同期による重複を防ぐため、以下の手順を自動化する計画を立ててください。..."

## Vision
ZenSyncは、複数のChromium系ブラウザ間でブックマークを同期する際の「重複・競合」という悪夢を完全に解消する、インテリジェントな同期マネージャーです。ブラウザ自体の同期エンジンを動的に制御（一時停止・再開）することで、クリーンな状態での書き込みを保証し、ユーザーのデジタルライフを整理整頓された状態に保ちます。

## Design Direction
- **Color palette**:
  - Primary: `#3B82F6` (Trust Blue) - 信頼と同期の象徴
  - Secondary: `#10B981` (Safe Green) - 保存完了と安全状態
  - Warning: `#F59E0B` (Caution Orange) - 同期停止中の注意喚起
  - Background: `#0F172A` (Deep Slate) - プロフェッショナルなダークモード
- **Typography**: `Inter` をメインに、固定幅フォント `JetBrains Mono` を状態表示に使用。
- **Layout philosophy**: **"Zen Dashboard"** - 余白を活かしつつ、現在どのブラウザが「保護（同期停止）」されているかをリアルタイムに表示。
- **Visual identity**: 
  - AIスロップ（過度なグラデーションや汎用イラスト）を徹底排除。
  - 状態遷移には CSS 遷移（Spring physics）を用い、滑らかな操作感を実現。
  - アイコンは Lucide-style のミニマルな線画を使用。
- **Inspiration**: Vercel, Linear, Raycast.

## Features (prioritized)

### Must-Have (Sprint 1-2)
1. **Advanced Preferences Modifier**:
   - `Preferences` ファイルを解析し、`sync.bookmarks` および `sync.keep_everything_synced` を精密に操作する機能。
   - Chrome, Edge, Brave の各プロファイルパスへの自動対応。
2. **Atomic Bookmark Injector**:
   - ブラウザ停止 → 同期無効化 → ブックマーク書き込み → ブラウザ起動 のアトミックなシーケンス。
   - `path-finder.js` と `browser-manager.js` の密結合による整合性確保。
3. **Transaction Logging**:
   - Preferences の変更履歴を記録し、万が一のクラッシュ時にも元の設定に復元できる仕組み。

### Should-Have (Sprint 3-4)
1. **Background Sync Re-activator**:
   - 保存処理から一定時間経過後、または次回のアプリ起動時に、同期を安全に再有効化するバックグラウンドタスク。
   - 「同期OFF」状態が長時間続くのを防ぐガードレール。
2. **Process Watcher**:
   - ブラウザが完全に終了したことを `taskkill` だけでなく、ファイルロックの解除レベルで確認する高度な待機ロジック。
3. **Smart Restart**:
   - ユーザーが最後に開いていたタブやウィンドウ構成を損なわない形でのブラウザ再起動（`--restore-last-session` の検討）。

### Nice-to-Have (Sprint 5+)
1. **Conflict Resolution Preview**:
   - 同期を再開する前に、クラウド側とローカル側で発生しそうな競合を視覚化してユーザーに提示。
2. **Custom Sync Schedule**:
   - 同期を無効化する時間をユーザーが指定できる機能。

## Technical Stack
- **Frontend**: React 18, Tailwind CSS, Framer Motion (アニメーション)
- **Backend**: Node.js, Express
- **Utilities**: 
  - `fs-extra` (ファイル操作の堅牢化)
  - `JSON5` (Preferencesファイルが厳密なJSONでない場合の対応検討)
  - `child_process` (ブラウザ制御)

## Evaluation Criteria

### Design Quality (weight: 0.3)
- 同期が停止している状態（警告状態）と、安全に同期されている状態（正常状態）の対比が明確か。
- 設定変更中のローディングアニメーションが「何が起きているか」を正確に伝えているか。

### Originality (weight: 0.2)
- ブラウザの内部設定をバイパスするのではなく、設定ファイルレベルで同期エンジンをコントロールするという「外科的」なアプローチの正確性。

### Craft (weight: 0.3)
- **Robustness**: ブラウザが起動している状態で Preferences を書き換えようとした際のガード。
- **Fallback**: 保存失敗時に元のブックマークだけでなく、Preferences 設定も元の「同期ON」状態に確実にロールバックされるか。
- **Performance**: ブラウザの終了から再起動までのダウンタイムが最小限（3秒以内）であること。

### Functionality (weight: 0.2)
- 以下のフローが3ブラウザ（Chrome/Edge/Brave）で完遂されること：
  1. 保存実行 -> ブラウザ終了
  2. Preferences 確認 (`sync.bookmarks: false`)
  3. Bookmarks 書き換え
  4. ブラウザ起動 (同期設定画面で「ブックマーク同期」がOFFになっていることを確認)
  5. その後、適切なタイミングで ON に戻ること。

## Sprint Plan

### Sprint 1: Surgery Foundation
- **Goals**: `Preferences` 操作用ユーティリティの実装と `path-finder.js` の拡張。
- **Tasks**:
  - `browser-manager.js` に `setSyncStatus(browser, enabled)` メソッドを追加。
  - `Preferences` 内の同期関連キーの網羅的調査と実装。
- **DoD**: スクリプト経由でブラウザの同期設定を確実に ON/OFF できる。

### Sprint 2: Safe Flow Integration
- **Goals**: `saveBookmarks` ワークフローの刷新。
- **Tasks**:
  - 同期無効化フローを `saveBookmarks` の前後に組み込む。
  - ブラウザ再起動ロジックの安定化。
- **DoD**: ブックマーク保存時にブラウザが再起動し、起動直後に同期がOFFになっている。

### Sprint 3: The "Boomerang" (Re-activation)
- **Goals**: 同期の自動復帰ロジック。
- **Tasks**:
  - バックグラウンドでの Preferences 監視と復帰。
  - UXを損なわない「同期再開」の通知。
- **DoD**: 保存完了から数分後、または次回の操作時に同期が自動で ON に戻っている。
