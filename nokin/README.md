# 納金電卓（Web版 v5.1）

iPhone・Androidのブラウザで動く版です。サーバー（Perl等）は不要で、GitHub Pagesに置くだけで使えます。

## 置き方（GitHub Pages・出番カレンダーと同じリポジトリの例）
1. リポジトリ gamaushi/deban に `nokin` フォルダを作る
2. このフォルダのファイル（index.html, manifest.json, icon-*.png）をそこへアップロード
3. iPhoneのSafariで https://gamaushi.github.io/deban/nokin/ を開く
4. 共有ボタン →「ホーム画面に追加」でアプリのように使える

## 読み取りの仕組み（Perl版の ocr.cgi の代わり）
- 写真は Cloudflare Workers の中継（https://nokin-ocr.admin11pm.workers.dev/）を通して Azure AI Vision で読む
- 中継のプログラムは worker.js（Cloudflareの画面に貼り付けて使う。ここに置いてあるのは控え）
- Azureのキー・エンドポイント・合言葉は Cloudflare の「Variables and Secrets」にだけ保存する
  （AZURE_ENDPOINT / AZURE_KEY / PASSWORD）。GitHubには絶対に書かない
- 今月の利用回数を数えるには、Cloudflare の KV を変数名 COUNT で結び付ける
- スマホでは「⚙ 設定」で合言葉を1回入れるだけ

## Android版との違い
- 撮影はiPhone標準のカメラ画面を使う（ピント・ズーム・ライトはカメラ側で操作）
- 端末内の読み取りは ML Kit の代わりに Tesseract.js（印刷文字のみ・精度は低め、初回に数MBダウンロード）
- 入力した金額はブラウザに保存されるので、撮影中にページが読み直されても消えない（「クリア」で消去）
