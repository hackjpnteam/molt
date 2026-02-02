# Molt Observer

Moltbook の「読むだけ」観測Bot - Read-only client for Moltbook social network.

## セットアップ手順

### 1. 依存関係のインストール

```bash
cd molt-observer
npm install
```

### 2. エージェント登録

```bash
npm run molt:register
```

初回実行時、以下の情報が表示されます:
- `api_key` (先頭8文字のみ表示)
- `claim_url` (X認証用URL)

**API Keyは `~/.config/moltbook/credentials.json` に自動保存されます (chmod 600)**

### 3. X認証 (人間が行うステップ)

登録後、X(Twitter)による認証が必要な場合があります:

1. `npm run molt:register` 実行後に表示される **Claim URL** にアクセス
2. Xアカウントでログイン
3. 画面の指示に従って認証を完了
4. 認証完了後、以下のコマンドでステータス確認:

```bash
npm run molt:verify
```

`status: claimed` と表示されれば認証完了です。

### 4. 動作確認

```bash
npm run molt:health
```

フィード取得または公開投稿取得が成功すれば完了です。

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `npm run molt:register` | エージェント登録 |
| `npm run molt:verify` | 認証ステータス確認 |
| `npm run molt:health` | ヘルスチェック (read-only動作確認) |

## ディレクトリ構造

```
molt-observer/
├── docs/              # 公式ドキュメントのローカルコピー
│   ├── skill.md
│   ├── heartbeat.md
│   ├── messaging.md
│   ├── developers.md
│   └── summary.md     # API仕様サマリー
├── scripts/           # 実行スクリプト
│   ├── molt_register.ts
│   └── molt_health.ts
├── src/               # クライアントライブラリ
│   └── molt_client.ts
├── package.json
├── .gitignore
└── README.md
```

## 運用上の注意

### セキュリティ

- **API Keyは絶対にコミットしない** - `.gitignore` で除外済み
- **API Keyをログに出力しない** - 表示は先頭8文字のみ
- **credentials.jsonのパーミッションは600** - owner read/write only
- **API Keyは www.moltbook.com 以外に送信しない**

### レート制限

| アクション | 制限 |
|-----------|------|
| 投稿 | 30分に1回 |
| コメント | 20秒に1回 |
| Read操作 | クライアント内で10 req/min に制限 |

### Read-only運用

このBotは観測専用です:
- 投稿・コメント・投票などの書き込み操作は実装していません
- フィード取得、公開投稿取得のみ実行可能

## トラブルシューティング

### API Keyが見つからない

```
Error: API Key not found. Please run "npm run molt:register" first.
```

→ `npm run molt:register` を実行してください。

### 認証が必要

```
status: pending_claim
```

→ Claim URLにアクセスしてX認証を完了してください。

### Early Access / 招待制エラー

```
登録には招待コードまたは Early Access が必要です
```

→ Moltbookが招待制の場合、以下で申請:
https://www.moltbook.com/developers/apply

## ブロック時の報告

登録時にブロックされた場合、スクリプトは停止し以下を報告します:
- ブロックの原因 (404, 認証エラー, etc.)
- 推奨される次のアクション

## ライセンス

MIT
