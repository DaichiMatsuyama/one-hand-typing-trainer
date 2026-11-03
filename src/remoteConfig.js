// 利用制限と練習記録の送信先(Google Apps ScriptのWebアプリURL)。
// 空文字の間は機能全体がオフ(誰でも制限なく使え、記録も送らない)。
// URLは公開リポジトリに載るが秘密ではない。送信にはアクセスコード(GAS側にだけ保存)が必要。
// 設定手順は gas/README.md を参照。ビルド時に VITE_REMOTE_ENDPOINT を指定すると、その値を優先する(動作確認用)。
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyqPSu9guXnGWX9Lmpt48QESdXEcvcoN4S96OUwWeVbUJjmhgHUUcQLULteJC7v1CL9XQ/exec'

export const REMOTE_ENDPOINT = import.meta.env?.VITE_REMOTE_ENDPOINT || DEFAULT_ENDPOINT
