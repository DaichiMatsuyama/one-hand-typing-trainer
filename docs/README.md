# 片手タイピングトレーナー

iPhoneの横画面で、左右片手ずつキーボードの位置を覚えるためのWebアプリ。友人が隙間時間（目安3〜5分）に、ログインやインストールなしで利用できることを優先する。

## 開発方針
- Vue 3 + Vite、HTML/CSS/JavaScript。初期公開先はGitHub Pages（静的配信）。
- iPhone Safariを第一対象。横向き推奨、縦向きには回転案内を表示。Web側から画面回転を強制できる前提にしない。
- 利用者はURLを開くだけ。PWA・ホーム画面追加は任意。
- 管理者向け集計は後続段階でGoogle Apps Script (GAS) + Google Sheetsを検討。利用者の明示的な同意が前提。

## ドキュメント
- `requirements.md`: 機能要件・受け入れ条件
- `screen-design.md`: UI・キーボードレイアウト
- `architecture.md`: 技術構成・保存・公開
- `AGENTS.md`: Codex等の開発エージェント向け指示
- `CLAUDE.md`: Claude Code向け指示

## 開発開始例
```bash
npm create vite@latest typing-trainer -- --template vue
cd typing-trainer
npm install
npm run dev
```

この引き継ぎ資料は仕様書であり、実装コードではない。未確定事項は推測で固定せず、プロトタイプで確認する。
