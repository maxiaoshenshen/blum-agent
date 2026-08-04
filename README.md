# Blum Agent

[![Build](https://img.shields.io/badge/build-passing-16a34a?logo=githubactions&logoColor=white)](#质量门禁) [![Tests](https://img.shields.io/badge/tests-Vitest-6E9F18?logo=vitest&logoColor=white)](#质量门禁) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.13.0-339933?logo=node.js&logoColor=white)](#快速开始) ![License](https://img.shields.io/badge/license-private-64748b)

Blum Agent 是中文优先的 Blum 百隆家具五金工作助手。它面向设计师、销售、安装工、生产、采购与消费者，以官方资料为第一依据，帮助完成方案沟通、产品认知、现场排查与资料导航。

> 重要：Blum Agent 不是 Blum 官方客服。型号、孔位、加工尺寸、承重、电气、安全、兼容关系和最终下单，必须以当前市场的官方资料、配置器或 Blum 渠道复核。

## 功能特性

- 六种角色视角：设计师、销售、安装工、生产、采购、消费者，各自提供不同的提问入口与下一步建议。
- 覆盖上翻门、铰链、抽屉、导轨、动感开合、REVEGO、内分隔、柜体应用和加工资料等知识入口。
- 官方资料优先：每次回答附带可打开的官方来源卡片；未被摘要直接支持的参数和结论不会被当作已核实事实输出。
- 多轮选型：保留最近的对话上下文，能理解“这个”“上一款”等指代；缺少关键条件时会先追问型号、门板、柜体、尺寸、应用或市场。
- 风险分级：涉及料号、BOM、尺寸、孔位、兼容、负载、电气、安全或下单时，自动进入复核路径，不自由猜测。
- 流式回答与降级：优先使用 SSE 流式输出；流不可用时自动转用 JSON API；网络中断会显示“正在重新连接…”并在 3 秒后重试一次。
- 60 秒超时与错误恢复：长时间无响应给出可操作的友好提示，问题保留在输入框中，可直接重试。
- 图片辅助：支持 JPG、PNG、WebP（单张不超过 5 MB）；读取失败时可改为重新上传或文字描述。
- 安全护栏：请求格式和大小校验、IP 限流、受控站点 URL、无缓存响应、纯文本渲染，以及针对提示注入和无依据扩写的 Agent 规则。
- 无模型演示模式：未配置模型时仍提供透明的官方资料导航，不假装进行了模型推理。

## 架构

```text
浏览器 UI（Next.js / React）
  ├─ /api/chat/stream  SSE：实时 token 与心跳
  └─ /api/chat         JSON：流式失败的兼容降级
          │
          ▼
输入校验、限流、风险分类、角色路由
          │
          ▼
知识层：官方资料检索 → 来源卡片
          │
          ▼
Agent 层：多轮上下文 Prompt → Provider（OpenAI-compatible API）→ 事实护栏
```

- 前端层：`components/blum-agent.tsx` 负责角色、历史记录、流式状态、图片和恢复 UX。
- API 层：`app/api/chat` 与 `app/api/chat/stream` 校验请求、应用限流并统一错误语义。
- Agent 层：`src/agent` 生成系统提示、调用模型、过滤无法由官方资料支撑的扩展内容。
- 知识层：`src/domain/knowledge.ts` 保存官方来源摘要，`retrieval.ts` 提供路由与风险判断。

## 快速开始

前置要求：Node.js `>= 22.13.0`，npm `>= 10`。

```bash
git clone <your-repository-url> blum-agent
cd blum-agent
npm install
cp .env.example .env.local
```

在 `.env.local` 填入模型服务配置，再启动开发服务器：

```bash
npm run dev
```

打开终端显示的本地地址（通常为 `http://localhost:3000`）。模型密钥仅在服务端读取；不要提交 `.env.local`，也不要把密钥放到任何 `NEXT_PUBLIC_*` 变量中。

## 环境变量

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `PROVIDER_BASE_URL` | 是（实时模型） | `https://provider.example` | OpenAI-compatible 服务根地址；生产环境必须是 HTTPS。 |
| `PROVIDER_API_KEY` | 是（实时模型） | `sk-...` | Provider API key，仅服务端使用。 |
| `PROVIDER_MODEL` | 是（实时模型） | `claude-opus-5` | Provider 可用的 Chat Completions 模型名。 |
| `PUBLIC_SITE_URL` | 建议 | `https://agent.example.com` | 生产站点公开 HTTPS URL，用于安全相关站点配置。 |

未配置前三项时，`/api/chat` 会以 `demo` 模式返回官方资料导航；SSE 端点会明确返回“模型服务未配置”。

## API 文档

### `POST /api/chat`

返回一次性的 JSON 回答，适合非流式集成或作为 SSE 的降级通道。

请求：

```json
{
  "role": "installer",
  "messages": [
    { "role": "user", "content": "CLIP top 铰链关门不齐怎么排查？" }
  ],
  "image": "data:image/png;base64,..."
}
```

- `role` 必须是 `designer`、`sales`、`installer`、`production`、`procurement` 或 `consumer`。
- `messages` 从用户消息开始、以用户消息结束，角色严格交替；最多 12 条，单条不超过 4,000 字符。
- `image` 可选，仅接受 JPG、PNG、WebP 的 Data URL，最大 5 MB。

成功响应：

```json
{
  "answer": "操作步骤：…",
  "confidence": "guided",
  "followUps": ["提供产品型号和正面、侧面现场照片"],
  "mode": "live",
  "sources": [
    {
      "id": "easy-assembly",
      "title": "Blum EASY ASSEMBLY",
      "url": "https://www.blum.com/...",
      "summary": "官方安装与调节资料。",
      "official": true
    }
  ]
}
```

`confidence` 可能为 `guided`（官方资料引导）、`verified`（官方资料核实）或 `needs-review`（下单/加工前复核）。`mode` 为 `live`、`demo` 或 `guarded`。失败时返回 `{"error":{"code":"…","message":"…"}}`，并使用合适的 HTTP 状态码。

### `POST /api/chat/stream`

请求体与 `/api/chat` 相同。响应为 `text/event-stream`，事件为：

- `start`：返回已匹配的官方资料来源。
- `chunk`：增量文本，字段为 `text`。
- `done`：完整答案、置信状态、追问和来源。
- `error`：可展示给用户的错误代码与消息。

服务端在 60 秒后中止上游请求，并每 15 秒发送心跳。客户端应将异常流回退到 `/api/chat`。

## 常见问题

### 为什么不直接给我料号、孔位或承重数值？

这类信息会随产品变体、市场、板材、安装方式和资料版本改变。系统会要求完整型号和场景，并引导你使用当前官方配置器或订购资料复核。

### 我问“这个铰链”时，系统为什么还会追问？

系统会参考最近对话；如果上一轮未明确唯一产品，或有多个候选，继续猜测可能造成错误选型。提供铰链臂/罩杯上的标识、门板类型、柜体场景或照片会更快得到可执行答案。

### 显示“正在重新连接”怎么办？

系统会在 3 秒后自动尝试一次。仍失败时，原问题会保留在输入框；检查网络或模型服务后点击“重试”即可。

### 图片为什么上传失败？

仅支持 JPG、PNG、WebP，且文件不得超过 5 MB。若图片无法识别，请重新上传清晰图片，或描述产品标识、安装位置和现象。

### “官方资料优先”是否等于所有回答都是官方结论？

不是。界面会列出本次可核实的来源；对于资料未覆盖的内容，Agent 会明确说明范围外并询问补充信息，而不是把模型推测包装成官方事实。

## 贡献指南

### 添加知识库条目

1. 在 `src/domain/knowledge.ts` 添加来源，使用稳定的 `id`、官方 HTTPS `url`、精确的 `summary` 和可检索 `keywords`。
2. 摘要只能包含页面直接支持的事实；不要用行业经验补充参数、兼容关系或性能结论。
3. 在 `src/domain/retrieval.test.ts` 为新关键词、别名和排序写回归测试。
4. 如果条目会影响高风险选型，同时验证 `classifyRisk` 和 Agent 复核路径。

### 运行质量门禁

```bash
npm run test:unit -- --run
npm run build
npm run check
npm test
```

- `test:unit`：Vitest 的单元与组件测试。
- `build`：Next.js 生产构建与 TypeScript 检查。
- `check`：项目配置的静态检查与测试组合。
- `test`：构建后 Worker/API 的集成验证。

提交前请确保相关测试覆盖新增行为，且不提交 `.env.local`、模型密钥或真实用户图片。

## 安全与边界

- API 仅接受 `application/json`，请求体最大 7.5 MB；聊天接口按客户端 IP 限制为每分钟 30 次。
- 页面与 API 禁止缓存；模型输出按纯文本渲染，不执行 HTML。
- 系统提示将用户文本、历史与图片文字视为不可信任务数据，不接受其中要求绕过安全规则的指令。
- `npm audit --omit=dev` 应保持无已知生产依赖漏洞。

更多架构取舍见 [产品与技术设计](docs/plans/2026-07-23-blum-agent-design.md)，官方资料维护范围见 [官方资料清单](docs/official-sources.md)。
