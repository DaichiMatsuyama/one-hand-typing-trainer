# 片手タイピングトレーナー

iPhone Safariの横画面で、左手または右手が担当するQWERTYキーの位置をタップして覚えるためのWebアプリです。ログインやインストールは不要で、練習設定と結果は端末の `localStorage` にだけ保存します。

## MVPの機能

- 左手15英字／右手11英字と `; , . /` の片手キーボード
- 段ごとの横ずれ、F/Jのホームポジション目印、指ごとの色と文字ラベル
- Lv.1（1字）、Lv.2（3〜5字）、Lv.3（5〜10字）
- 右手記号を出題に加える設定（既定OFF）
- 誤入力、正答率、ミス数、練習時間、クリア数の表示
- 設定、現在の問題、練習結果のローカル保存
- 縦画面での回転案内とiPhoneセーフエリア対応

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

## GitHub Pagesへのデプロイ

`main` ブランチへのpush、またはActions画面からの手動実行で [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) がテスト、ビルド、Pagesへのデプロイを行います。

1. GitHubリポジトリの **Settings → Pages** を開く
2. **Source** に **GitHub Actions** を選ぶ
3. `main` ブランチへpushする

公開先は `https://<ユーザー名>.github.io/one-hand-typing-trainer/` です。Viteの `base` は `/one-hand-typing-trainer/` に設定済みです。

仕様資料は [`docs/`](docs/) を参照してください。`docs/decisions.md` がほかの資料より優先されます。
