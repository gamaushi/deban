# 納金電卓（Web版 v5.0）

iPhone・Androidのブラウザで動く版です。サーバー（Perl等）は不要で、GitHub Pagesに置くだけで使えます。

## 置き方（GitHub Pages・出番カレンダーと同じリポジトリの例）
1. リポジトリ gamaushi/deban に `nokin` フォルダを作る
2. このフォルダのファイル（index.html, manifest.json, icon-*.png）をそこへアップロード
3. iPhoneのSafariで https://gamaushi.github.io/deban/nokin/ を開く
4. 共有ボタン →「ホーム画面に追加」でアプリのように使える

## Azure（手書きの読み取り）の設定
- 画面右上の「⚙ 設定」でエンドポイントとキーを入れて保存（そのスマホのブラウザ内だけに保存）
- キーはGitHubに置かないこと（公開されてしまうため）
- 長いキーを打つのが面倒なら、次のURLを一度だけ開くと自動で保存され、URLからは消えます
  https://gamaushi.github.io/deban/nokin/#ep=https://(リソース名).cognitiveservices.azure.com/&key=(キー1)
  ※このURLは他人に渡さないこと

## Android版との違い
- 撮影はiPhone標準のカメラ画面を使う（ピント・ズーム・ライトはカメラ側で操作）
- 端末内の読み取りは ML Kit の代わりに Tesseract.js（印刷文字のみ・精度は低め、初回に数MBダウンロード）
- 入力した金額はブラウザに保存されるので、撮影中にページが読み直されても消えない（「クリア」で消去）
