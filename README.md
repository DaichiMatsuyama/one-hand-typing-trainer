# 片手タイピングトレーナー

iPhone Safariの横画面で、左手または右手が担当するQWERTYキーの位置をタップして覚えるためのWebアプリです。ログインは不要で、練習設定と結果は端末の `localStorage` にだけ保存します。Safariタブでも利用できますが、キーをより大きく表示するにはホーム画面からの全画面利用を推奨します。

## MVPの機能

- 左手15英字／右手11英字と `; , . /` の片手キーボード
- 段ごとの横ずれ、F/Jのホームポジション目印、指ごとの色と文字ラベル
- Lv.1（1字）、Lv.2（3〜5字）、Lv.3（5〜10字）
- 右手記号を出題に加える設定（既定OFF）
- 誤入力、正答率、ミス数、練習時間、クリア数の表示
- 設定、現在の問題、練習結果のローカル保存
- 縦画面での回転案内とiPhoneセーフエリア対応
- 設定・出題・成績を手に隠れにくい画面上部へまとめた情報ストリップ

## iPhoneのホーム画面から使う

1. Safariで公開ページを開く
2. 共有ボタンをタップする
3. **ホーム画面に追加**を選ぶ
4. 追加された「片手タイピング」を横向きで起動する

ホーム画面から起動するとSafariのアドレスバーがなくなり、キーに使える高さが増えます。manifestは横向きのstandalone表示を指定していますが、Service Workerやオフライン動作はこの段階では実装していません。

キーの間隔（pitch）は、セーフエリアと上部48pxの情報ストリップを除いた高さに3段を収められる値と、利用可能な幅に5キー＋最大0.75キー分の段ずれを収められる値の小さい方です。上限の `115px` は、iPhoneの約153 CSS px/inch（460ppi ÷ 3倍）を基準に、実物キーボードの約19mm間隔へ近づけた値です。通常のSafariで表示領域が不足する場合は、重なりやスクロールを避けるため自動的に縮小します。

## 開発

Node.jsとnpmを用意し、次を実行します。

```bash
npm install
npm run dev
```

テストと本番ビルド:

```bash
npm test
npm run build
```

Viteの開発サーバーを同一ネットワーク上のiPhoneから確認する場合は、`npm run dev -- --host` を利用できます。

ホーム画面アイコンを再生成する場合は、追加依存なしで次を実行します。

```bash
node scripts/generate-icons.mjs
```

生成物は通常表示用の `public/icons/icon-180.png` / `public/icons/icon-512.png` と、キー外形を中央80%の安全円内に収めたmaskable用の `public/icons/icon-maskable-512.png` です。manifestでは通常用（`purpose: any`）とmaskable用（`purpose: maskable`）を別エントリにしています。

## GitHub Pagesへのデプロイ

`main` ブランチへのpush、またはActions画面からの手動実行で [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) がテスト、ビルド、Pagesへのデプロイを行います。

1. GitHubリポジトリの **Settings → Pages** を開く
2. **Source** に **GitHub Actions** を選ぶ
3. `main` ブランチへpushする

公開先は `https://<ユーザー名>.github.io/one-hand-typing-trainer/` です。Viteの `base` は `/one-hand-typing-trainer/` に設定済みです。

仕様資料は [`docs/`](docs/) を参照してください。`docs/decisions.md` がほかの資料より優先されます。
