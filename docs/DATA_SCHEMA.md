# データ構造 v1
全日時はISO 8601。IDはUUIDなどの英数字・ハイフン・アンダースコア・コロン。順序はsortOrder、変更時はupdatedAtを更新します。
以下はすべて架空データです。

## deck
```json
{"id":"deck-example","name":"架空の合言葉","description":"練習用","icon":"✦","color":"#a695ff","sortOrder":0,"createdAt":"2026-09-30T00:00:00Z","updatedAt":"2026-09-30T00:00:00Z"}
```

## question
必須は登録UI上のprompt/answer。DB保存時にはid/deckIdなどをアプリが付加します。読み上げ文字列の空欄は表示文字列を使います。
```json
{"id":"question-example","deckId":"deck-example","prompt":"青チームの合言葉","answer":"スター","acceptedAnswers":["すたー"],"promptSpeech":"あおちーむのあいことば","answerSpeech":"すたー","note":"架空の問題","tags":["色"],"enabled":true,"statVersion":1,"sortOrder":0,"createdAt":"2026-09-30T00:00:00Z","updatedAt":"2026-09-30T00:00:00Z"}
```

## answer（session.answers内）
```json
{"id":"answer-example","questionId":"question-example","statKey":"question-example:1","deckId":"deck-example","promptSnapshot":"青チームの合言葉","answerSnapshot":"スター","noteSnapshot":"架空の問題","at":"2026-09-30T00:10:01Z","elapsed":900,"limit":4500,"grade":"PERFECT","source":"voice","recognized":"スター","recognitionCorrected":false,"direction":"forward"}
```
grade: PERFECT/GREAT/GOOD/MISS。source: voice/manual/typed/timeout。elapsed/limitはミリ秒。recognizedは認識結果または文字回答。認識ミス修正は同じanswerのフラグとgradeを更新し、回答数を増やしません。

v1.1.0の任意項目：question.choices（文字列配列、正解は自動追加）、excludeChoices（誤答にしない候補）、choiceGroup（品詞など）、choiceCategory（同種候補の優先）、promptLang/answerLang（既定ja-JP）。古いquestionの欠落を許容します。
answer.sourceにはchoiceも追加。選択回答はselectedAnswerSnapshotとchoicesSnapshotを保持します。session.answerModeとsettings.answerModeはchoices/recall。旧settingsはchoicesへ補完し、既存sessionは変更しません。

## stat
```json
{"id":"question-example:1","questionId":"question-example","deckId":"deck-example","asked":1,"correct":1,"incorrect":0,"PERFECT":1,"GREAT":0,"GOOD":0,"MISS":0,"totalTime":900,"totalRatio":0.2,"averageTime":900,"averageRatio":0.2,"streak":1,"accuracy":1,"mastery":73,"lastAnswered":"2026-09-30T00:10:01Z","lastMiss":null}
```
accuracyは0〜1、masteryは0〜100。statVersionを増やすと新しいstat.idを使用し、旧版の統計は残します。上記のmasteryは計算例。実際の式はcore.jsを正としてください。

## session
```json
{"id":"session-example","deckId":"deck-example","deckNameSnapshot":"架空の合言葉","difficulty":"NORMAL","mode":"count","direction":"forward","target":10,"startedAt":"2026-09-30T00:10:00Z","endedAt":"2026-09-30T00:11:00Z","status":"completed","answers":[],"summary":{"score":0,"count":0,"accuracy":null,"averageTime":null,"bestCombo":0,"combo":0,"PERFECT":0,"GREAT":0,"GOOD":0,"MISS":0}}
```
mode: count/time。targetは実際の問題数または分数。status: playing/completed。タブ終了などでendedAtなしの履歴も保持します。summaryはanswersから再計算できます。

## settings
```json
{"id":"main","speechEnabled":true,"speechVolume":0.9,"bgmVolume":0.22,"seVolume":0.55,"recognitionMode":"local","remoteConsent":false,"allowSan":true,"difficulty":"NORMAL","vibration":true,"effects":true,"bgmTrack":"focus","favoriteMinutes":[],"sessionMode":"count","count":10,"minutes":2,"direction":"forward","selectedDeckId":"deck-example"}
```
recognitionMode: local/remote/off。remoteには利用者の明示同意remoteConsentが必要。音量は0〜1。お気に入り時間は1〜120分。

## backup
```json
{"schemaVersion":1,"exportedAt":"2026-09-30T00:00:00Z","settings":{"id":"main"},"decks":[],"questions":[],"stats":[],"sessions":[]}
```
音楽は含みません。バックアップ検証には各recordの必須項目も必要です。デッキ名・問題・回答・履歴は端末内の情報で、外部へ自動送信しません。利用者が出力・共有したファイルにはこれらの情報が含まれます。
AI出力はformat=memory-beat-ai-edit。設定・統計・履歴は含みません。完全バックアップの復元画面でAI出力を復元しないでください。

## audio / meta
```json
{"id":"custom","name":"my-music.mp3","blob":"IndexedDB上のBlob（JSON対象外）","importedAt":"2026-09-30T00:00:00Z"}
```
metaには教材導入印（例：id=installed-toeic-v1、installedAt=ISO日時）を保存し、利用者が編集・削除した教材を毎起動で上書きしません。

## 互換性
- 追加する任意項目は既定値を用意し、古いrecordの欠落を許容。
- 既存項目名・ID・DB名は変更しない。
- DB構造変更はDB_VERSIONを増やし、非破壊migration。
- バックアップschema変更は旧版からの変換関数を用意。未知版を黙って読み込まない。
- 削除済み問題のsnapshotや旧統計版を壊さない。
- 空データや単一recordの破損で全画面を起動不能にしない。
