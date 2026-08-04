# Blum Agent API 文档

## 概述

Blum Agent API 提供基于 Blum 官方资料的 AI 问答服务。回答会附带本次检索到的资料来源、置信度和下一步建议；对于料号、孔位、承重、精确尺寸等高风险选型问题，请始终以当地市场最新版官方配置器、订购手册和产品资料为最终依据。

## 基础信息

- 基础 URL: `https://blum-agent-cn.maxiaoshen.chatgpt.site`
- 协议: HTTPS
- 请求格式: JSON，使用 `Content-Type: application/json`
- 非流式响应格式: JSON
- 流式响应格式: Server-Sent Events (`text/event-stream`)
- 认证: 无（应用层公开 API）

所有 API 响应均包含 `Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。聊天接口还会返回 `X-Request-ID`；提交该请求头（8-128 位字母、数字、`_` 或 `-`）可用于关联自己的日志与排障。

> 部署提示：应用本身不实现 API 鉴权。若托管平台启用了登录保护、WAF 或访问策略，外部调用仍会被该平台拦截；正式面向公众前，应确认以上基础 URL 可匿名访问这些 API 路径，或在网关层另行定义认证方案。

## 通用请求约束

- `role` 缺省时为 `consumer`。
- `messages` 必须从 `user` 开始、以 `user` 结束，并严格交替 `user` / `assistant`。
- 单条消息最多 4,000 个字符；全对话最多 12,000 个字符；服务端最多保留最近 12 条消息。
- 请求体最大 7.5 MB。若上传图片，解码后最大 5 MB。
- `image` 可选，必须为 JPG、PNG 或 WebP 的 Data URL，且内容实际格式须与 MIME type 一致。

## 端点

### `POST /api/chat`

非流式对话接口。适用于服务端调用、一次性获取完整回答，或流式接口不可用时的回退。

#### 请求

```json
{
  "role": "consumer",
  "messages": [
    {"role": "user", "content": "CLIP top 最大开门角度是多少？"}
  ],
  "image": "data:image/png;base64,..."
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `role` | string | 否 | 用户角色，默认 `consumer`。 |
| `messages` | array | 是 | 对话消息数组，至少含一条非空的用户消息。 |
| `messages[].role` | string | 是 | `user` 或 `assistant`。 |
| `messages[].content` | string | 是 | 消息正文。 |
| `image` | string | 否 | JPG、PNG 或 WebP 的 Base64 Data URL。 |

#### 角色选项

- `designer`: 设计师
- `sales`: 销售
- `installer`: 安装工
- `production`: 生产
- `procurement`: 采购
- `consumer`: 消费者

#### 成功响应

```json
{
  "answer": "CLIP top 铰链的标准开合角度为 95°，另有 110°、120° 和 155° 可选。",
  "confidence": "verified",
  "followUps": ["告诉我更多关于 BLUMOTION 的信息"],
  "mode": "live",
  "sources": [
    {
      "id": "cliptop",
      "title": "CLIP top 铰链系列",
      "url": "https://www.blum.com/...",
      "summary": "...",
      "official": true
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `answer` | 完整的纯文本回答。 |
| `confidence` | 回答置信等级，见下文说明。 |
| `followUps` | 推荐的后续问题或所需补充信息。 |
| `mode` | 回答模式：`live`、`demo` 或 `guarded`。 |
| `sources` | 本次回答匹配到的官方来源列表。 |
| `sources[].official` | 始终为 `true`，表示该来源为官方资料。 |

#### 置信度与模式说明

- `verified`: 回答可由官方资料直接核实。
- `guided`: 回答由官方资料引导，但可能受产品变体、市场或上下文限制。
- `needs-review`: 涉及精确选型或关键参数，使用前必须复核。
- `live`: 已由模型服务生成回答。
- `demo`: 模型服务不可用或未配置时的资料型回退回答。
- `guarded`: 请求风险较高或资料不足，系统会限制结论并要求补充信息或复核。

#### 错误响应

错误均使用以下结构：

```json
{
  "error": {
    "code": "invalid_json",
    "message": "请求内容不是有效的 JSON。"
  }
}
```

| HTTP 状态 | 常见 `error.code` | 含义 |
| --- | --- | --- |
| 400 | `invalid_json`、`invalid_request`、`invalid_role`、`missing_message`、`invalid_message`、`invalid_message_order`、`message_too_long`、`conversation_too_long`、`unsupported_image`、`image_too_large` | 请求字段、消息顺序或图片无效。 |
| 413 | `request_too_large` | 请求体过大。 |
| 415 | `unsupported_media_type` | `Content-Type` 不是 `application/json`。 |
| 429 | `rate_limited` | 请求过于频繁。见限流说明。 |
| 500 | `internal_error` | 服务器内部错误。 |

上游模型服务错误也会以 JSON 错误结构返回；客户端应保留原问题并允许用户稍后重试。

### `POST /api/chat/stream`

流式对话接口。请求体与 [`POST /api/chat`](#post-apichat) 完全相同，响应为 `text/event-stream; charset=utf-8`。适合直接驱动聊天界面。

服务端会先发送 `start`，随后发送零个或多个 `chunk`，最后发送 `done`；发生错误时发送 `error`。服务端每 15 秒发送一次 SSE 注释心跳（`:\n\n`），并在 60 秒时中止上游模型请求。

#### SSE 事件

```text
event: start
data: {"sources":[{"id":"cliptop","title":"CLIP top 铰链系列","url":"https://www.blum.com/...","summary":"...","official":true}]}

event: chunk
data: {"text":"CLIP top ...","accumulated":"CLIP top ..."}

event: done
data: {"answer":"完整答案","confidence":"guided","followUps":["..."],"sources":[...]}
```

| 事件 | 数据字段 | 说明 |
| --- | --- | --- |
| `start` | `sources` | 回答开始前已匹配的官方资料。 |
| `chunk` | `text`, `accumulated` | 新增文本与到当前为止的完整文本。 |
| `done` | `answer`, `confidence`, `followUps`, `sources` | 正常完成的最终结果。 |
| `error` | `code`, `message` | 可展示给用户的错误。 |

流式接口的 HTTP 错误状态可能为 400、413、415、429、500 或 503。即使是错误响应，正文也遵循 SSE `error` 事件格式。客户端应在网络中断、超时或未收到 `done` 时回退调用 `/api/chat`。

### `GET /api/health`

健康检查接口，无需请求体。

#### 成功响应

```json
{
  "status": "healthy",
  "timestamp": "2026-08-05T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 123.45
}
```

| 字段 | 说明 |
| --- | --- |
| `status` | 当前为 `healthy`。 |
| `timestamp` | 服务生成响应时的 ISO 8601 时间。 |
| `version` | 当前应用版本。 |
| `uptime` | 运行时已持续的秒数。 |

### `POST /api/feedback`

用户反馈接口。反馈会经过格式与频率校验；当前接口仅确认接收，不返回或持久化可识别的用户内容。

#### 请求

```json
{
  "answerId": "answer-123",
  "rating": "helpful",
  "comment": "步骤很清楚",
  "timestamp": 1785902400000
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `answerId` | string | 是 | 客户端生成或关联的回答 ID，1-160 个字符。 |
| `rating` | string | 是 | `helpful` 或 `inaccurate`。 |
| `comment` | string | 否 | 可选文字反馈，最多 1,000 个字符。 |
| `timestamp` | number | 是 | Unix 时间戳（毫秒）。 |

#### 成功响应

```json
{"success": true}
```

#### 错误响应

该端点使用与聊天接口相同的 `{"error":{"code":"...","message":"..."}}` 结构。可能状态为：400（`invalid_json` 或 `invalid_feedback`）、413（`request_too_large`）、415（`unsupported_media_type`）和 429（`rate_limited`）。反馈请求体最大 16 KB。

## 限流

- 聊天接口（`/api/chat` 和 `/api/chat/stream`）：每个客户端 IP 每分钟 30 次。两个端点共用此配额。
- 反馈接口（`/api/feedback`）：每个客户端 IP 每分钟 3 次。
- 超限时返回 HTTP 429、`error.code: "rate_limited"`，并包含 `Retry-After`（秒）。`/api/chat` 的 429 响应另包含 `X-RateLimit-Limit`、`X-RateLimit-Remaining` 和 `X-RateLimit-Reset`。

请在收到 429 后等待 `Retry-After` 指定的时长；不要用并发重试绕过限流。

## 示例代码

以下示例使用完整的 API 地址。生产代码请为网络、超时、429 和非 2xx 响应建立适当的重试与用户提示策略。

### JavaScript（非流式）

```js
const response = await fetch("https://blum-agent-cn.maxiaoshen.chatgpt.site/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Request-ID": crypto.randomUUID(),
  },
  body: JSON.stringify({
    role: "installer",
    messages: [
      { role: "user", content: "MERIVOBOX 抽屉安装后阻尼不顺，先检查什么？" },
    ],
  }),
});

const body = await response.json();
if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
console.log(body.answer, body.sources);
```

### JavaScript（读取 SSE）

```js
const response = await fetch("https://blum-agent-cn.maxiaoshen.chatgpt.site/api/chat/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    role: "consumer",
    messages: [{ role: "user", content: "BLUMOTION 是什么？" }],
  }),
});

if (!response.ok || !response.body) throw new Error("流式请求失败");
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop() ?? "";
  for (const event of events) {
    const name = event.match(/^event: (.+)$/m)?.[1];
    const data = event.match(/^data: (.+)$/m)?.[1];
    if (!name || !data) continue;
    const payload = JSON.parse(data);
    if (name === "chunk") process.stdout.write(payload.text);
    if (name === "done") console.log("\n完成", payload.sources);
    if (name === "error") console.error(payload.message);
  }
}
```

### Python

```python
import requests

response = requests.post(
    "https://blum-agent-cn.maxiaoshen.chatgpt.site/api/chat",
    headers={"Content-Type": "application/json"},
    json={
        "role": "designer",
        "messages": [
            {"role": "user", "content": "上翻门系统选型时需要哪些尺寸？"}
        ],
    },
    timeout=70,
)
response.raise_for_status()
result = response.json()
print(result["answer"])
for source in result["sources"]:
    print(source["title"], source["url"])
```

### curl

```bash
curl --request POST "https://blum-agent-cn.maxiaoshen.chatgpt.site/api/chat" \
  --header "Content-Type: application/json" \
  --data '{
    "role": "sales",
    "messages": [
      {"role": "user", "content": "LEGRABOX 与 MERIVOBOX 的定位差异是什么？"}
    ]
  }'
```

以流式方式调用时，增加 `--no-buffer`：

```bash
curl --no-buffer --request POST "https://blum-agent-cn.maxiaoshen.chatgpt.site/api/chat/stream" \
  --header "Content-Type: application/json" \
  --data '{"role":"consumer","messages":[{"role":"user","content":"CLIP top 是什么？"}]}'
```
