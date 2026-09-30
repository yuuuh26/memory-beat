# MEMORY BEAT：AI編集ガイド

## 目的と守ること
自由な問題と答えを端末で登録し、落下ゲーム・選択式・声・手動判定・BGMで反復する汎用暗記PWAです。
既存の `yuuuh26/toeic-beat` は変更しません。実際の人名・会社・部署・業務情報をソース、テスト、GitHub、ログへ書かないでください。内蔵教材は公開可能なTOEIC英単語500語、任意サンプルは架空の合言葉です。外部AI APIや分析・広告SDKは使いません。

## 構造
ビルド不要の静的HTML/CSS/ES Modulesです。ファイルを直接編集し、HTTPサーバーで確認できます。

| ファイル | 役割・変更する機能 |
| --- | --- |
| index.html | 初期HTML、ナビゲーション、noindex、manifestリンク |
| styles.css | スマホ・PCのレイアウト、落下カード、正解演出、動きを減らす設定 |
| js/config.js | 難易度時間、判定境界、得点、粒子上限、問題数・時間選択肢、既定設定、内蔵BGM |
| js/core.js | 正規化、別解判定、PERFECT/GREAT/GOOD/MISS、習熟度、重み付き出題、日別集計、TSV解析。DOM非依存 |
| js/db.js | IndexedDBのmigration、読み込み、複数storeのatomic transaction、永続保存 |
| js/game.js | ゲーム状態、落下時間、読み上げ後の回答時計、音声・手動・文字回答、停止・再開、誤認識修正、逐次保存 |
| js/speech.js | 日本語TTS、端末内認識の機能検出、日本語パック、通常認識。暗黙のクラウド切り替えは禁止 |
| js/audio.js | Web AudioのオリジナルBGMとSE、ローカル音楽ファイル、発音中の音量抑制 |
| js/effects.js | 粒子・円形リング・フラッシュ・コンボ。粒子上限とreduced motionを尊重 |
| js/editor.js | ゲーム/問題CRUD、詳細設定、TSVプレビュー、一括操作、並び順、変更時の学習版 |
| js/stats.js | ゲーム別/総合overview、日付の欠測補完 |
| js/charts.js | 外部ライブラリ不要のSVGグラフ。学習なしは0%にしない |
| js/backup.js | 完全JSONとAI用JSON出力、設定の許可値、復元検証・確認・transaction |
| js/app.js | 画面切り替え、ホーム、成績、履歴、設定、PWA更新・追加 |
| js/packs.js / data/toeic.json | 公開可能な教材の一度だけの導入。TOEIC英単語500語と例文 |
| js/pwa.js / update.html | SW更新完了待ち、古いキャッシュからのデータ保持付き更新入口 |
| js/utils.js | DOM補助、HTML escaping、確認dialog、ダウンロード、クリップボード、エラー表示 |
| sw.js | このアプリだけのオフラインキャッシュ |
| manifest.webmanifest / icons | PWA情報、専用SVGと192/512/maskableアイコン |

機能変更時に `app-loader.js` やソース文字列置換、後付けパッチを導入しないでください。数値は原則config.jsへ集約します。

## 保存・履歴の保護
- DB名は **yuu-memory-beat**、DB versionは1。TOEIC BEATと分離しています。
- store：settings / decks / questions / stats / sessions / audio / meta。
- migrationでは新しいstore/項目を追加します。既存storeやDBを削除しないでください。
- `deleteDatabase` は使用しません。全削除は設定の最深部で2段階確認した場合のみ、明示的なstore clearを行います。
- 回答ごとにstatsとsessionを一つのtransactionで保存します。失敗したら次へ進まず保存を再試行できます。
- 答え変更時、利用者が新しく学ぶことを選んだ場合だけ `statVersion` を増やします。統計IDは `questionId:statVersion`。古い統計版は残します。
- sessionはdeckNameSnapshot、各回答はpromptSnapshot/answerSnapshot/noteSnapshotを保持します。履歴表示に現在の問題文を代用しないでください。
- 問題移動後の現在の統計は新ゲームに属しますが、過去sessionの所属は当時のゲームです。
- 逆方向学習は同じ問題の習熟度に集計します。回答にはdirectionと当時の出題方向を保存します。
- 復元は先に完全検証し、追加/上書きを既定値とします。置き換えには追加確認があります。失敗時はtransaction全体をrollbackします。
- 音楽Blobはaudio storeのみ。完全JSONには含めず、復元時は現在の音楽を保持します。

## 音声と時計
- 初期設定はanswerMode=choices（選択式）、recognitionMode=off。選択式は音声APIを呼ばずマイクも表示しません。
- 通常認識は説明dialogで同意した場合だけ使用。復元後には同意を再確認します。
- TTSはpromptLang（既定ja-JP、TOEICはen-US）と一致するlocalService=trueの音声だけを選びます。ない場合は文字で出題します。
- 問題の読み上げ完了または失敗後に回答時計を開始します。
- onspeechstartがある場合、その時点を速度に使用。文字認識が遅れた場合は上限1.6秒だけ結果を待ちます。認識確定が必須です。
- 誤認識の修正は同じ回答・同じ統計をbaselineから再計算し、二重カウントしません。
- タブ非表示時は停止。再開を利用者が押すまで時計・音声・BGMを再開しません。

## 選択式・新ジャンル
- core.jsのchoicesForが正解1つ+最大3つの誤答を生成。choices指定があれば優先し、なければ同じdeck内の答えを使用します。
- 別解、同じ意味、excludeChoicesに指定された候補は誤答にしません。TOEICでは品詞choiceGroupとカテゴリchoiceCategoryも考慮します。
- 逆方向ではprompt/answerと言語を交換し、順方向用choices/excludeChoicesを使い回しません。
- 誤答候補が0件なら手動/文字へフォールバックし、架空の誤答を生成しません。
- 未来の公開教材はdataのJSONとBUILTIN_PACKSへ追加可能。IDを固定し、一度だけmetaへ導入印を保存します。既存問題・成績を書き換えないでください。
- 会社情報など非公開ジャンルは端末内登録または完全バックアップ形式のインポートへ。GitHubへ教材をコミットしないでください。

## PWA更新
1. アプリ本体を変更したらsw.jsのVERSIONを必ず増やす。
2. config.jsのVERSION、package.json、画面表記も必要に応じて同期。
3. 新モジュールやアイコンを追加したらASSETSへ追加。
4. PREFIX `yuu-memory-beat-app-` 以外のキャッシュは削除しない。
5. IndexedDBはキャッシュ更新で消さない。
6. プレイ中は強制reloadしない。更新ボタンまたは全タブを閉じて再起動で新版へ移行。
7. manifest.idはアプリ専用の `/memory-beat/` を固定。`./` はoriginのルートへ解決されるため使わない。scope/start_urlも本アプリのパス内とする。

## 検証
```sh
npm test
python3 -m http.server 8765
```
`tests/browser.cjs` は別途PlaywrightとChromiumがある環境で実行できます。公開URLでも実行可能です。
```sh
MEMORY_BEAT_TEST_URL=https://yuuuh26.github.io/memory-beat/ node tests/browser.cjs
```
実際の人名や会社情報でテストしないでください。詳しい確認順序はCHANGE_CHECKLIST.mdとtests/VERIFICATION.mdを参照。
