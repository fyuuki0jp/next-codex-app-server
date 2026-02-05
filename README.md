# Codex App Server Demo

OpenAI Codex の `app-server` モードを使用したチャットアプリケーションのデモプロジェクトです。

## 概要

このプロジェクトは [Codex App Server API](https://developers.openai.com/codex/app-server) を Next.js から利用する実装例です。Codex CLI の `codex app-server` コマンドを子プロセスとして起動し、JSON-RPC 2.0 over JSONL で双方向通信を行います。

## 機能

- Codex Agent とのリアルタイムチャット
- Server-Sent Events によるストリーミングレスポンス
- コマンド実行結果の表示
- ファイル変更の追跡と表示
- 承認ワークフローの自動処理

## 前提条件

- Node.js 20+
- [Codex CLI](https://github.com/openai/codex) がインストール済みであること
- OpenAI API キーまたは ChatGPT アカウントでログイン済みであること

## セットアップ

```bash
# 依存関係のインストール
pnpm install

# 開発サーバーの起動
pnpm dev
```

ブラウザで http://localhost:3000 を開くとチャット画面が表示されます。

## プロジェクト構成

```
src/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts      # SSE エンドポイント
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── Chat.tsx              # チャット UI
└── infrastructure/
    └── codex/
        ├── index.ts          # CodexAppServer クラス
        └── schemas/          # 型定義 (ts-rs で生成)
```

## CodexAppServer クラス

`src/infrastructure/codex/index.ts` に型安全な Codex App Server クライアントを実装しています。

### 使用例

```typescript
import { CodexAppServer } from "@/infrastructure/codex";

const codex = CodexAppServer.getInstance();

// 初期化
await codex.initialize(
  { name: "my-app", version: "1.0.0", title: null },
  { experimentalApi: false }
);

// スレッド開始
const { thread } = await codex.startThread({});

// イベント購読
codex.onNotification("item/agentMessage/delta", (params) => {
  console.log("Delta:", params.delta);
});

// メッセージ送信
await codex.sendMessage(thread.id, "Hello!");

// 承認ハンドラ登録
codex.onServerRequest("item/commandExecution/requestApproval", async (params) => {
  return { decision: "accept" };
});
```

## API リファレンス

### POST /api/chat

メッセージを送信し、SSE でレスポンスをストリーミングします。

**リクエスト:**
```json
{ "message": "こんにちは" }
```

**SSE イベント:**
- `delta` - テキストの差分
- `command_start` / `command_output` / `command_end` - コマンド実行
- `file_change_start` / `file_change_end` - ファイル変更
- `complete` - ターン完了
- `error` - エラー

### DELETE /api/chat

現在のスレッドをリセットして新しい会話を開始します。

## 参考リンク

- [Codex App Server API ドキュメント](https://developers.openai.com/codex/app-server)
- [Codex CLI GitHub](https://github.com/openai/codex)
- [Next.js ドキュメント](https://nextjs.org/docs)
