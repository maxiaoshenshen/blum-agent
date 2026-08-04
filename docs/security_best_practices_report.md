# Blum Agent 安全审计（2026-08-05）

## 摘要

已检查 Next.js/React 前后端、Cloudflare Worker 入口、聊天与反馈 API、模型适配层以及依赖清单。应用不使用数据库或动态命令执行；用户文字由 React 文本节点渲染，未发现 SQL injection、DOM XSS sink、`eval`、`new Function`、开放 CORS 或已跟踪的密钥文件。已修复伪装图片、反馈日志泄露、跨聊天端点限流规避与 CSP 中的 `unsafe-eval`。

## 已修复

### SEC-001 — High — 伪装为图片的任意二进制内容可传给模型服务

- Location: `src/agent/schema.ts:99-145` (`parseImage`)
- Evidence: 过去仅用 `data:image/...` 前缀和 base64 正则判断类型。
- Impact: 攻击者能以 `image/png` 的 data URL 传入任意文件内容；上游的解析行为不可控，也会浪费模型请求配额。
- Fix: 在大小检查后解码 base64，核验 PNG、JPEG 与 WebP 的文件签名，并拒绝无效编码和 MIME/内容不符的文件。
- Verification: `src/agent/schema.test.ts` 覆盖伪装脚本与有效 PNG 签名。

### SEC-002 — Medium — 用户反馈正文被写入运行日志

- Location: `app/api/feedback/route.ts:100-103`
- Evidence: 过去 `console.log` 了完整 `answerId`、评分与可选用户评论。
- Impact: 评论可能含个人信息、订单信息或攻击载荷，并会扩散到日志系统。
- Fix: 移除原文日志；反馈目前无持久化实现。若接入存储，须采用访问控制、保留期和最小字段原则。
- Verification: `app/api/feedback/route.test.ts` 断言成功请求不会写日志。

### SEC-003 — Medium — 可通过在 JSON 与 SSE 聊天端点间切换扩大配额

- Location: `app/api/chat/route.ts:102`, `app/api/chat/stream/route.ts:81`, `src/security/chat-rate-limit.ts`
- Evidence: 两个 endpoint 原有相互独立的 30/min 限流器。
- Impact: 单一用户可得到约双倍模型调用额度。
- Fix: 两个应用 endpoint 共享同一个 30/min 限流器；Worker 边缘层也覆盖两个路径。身份仅采用 Cloudflare 注入的 `CF-Connecting-IP`，不再信任可伪造的 `X-Forwarded-For`。
- Verification: 现有各 endpoint 限流测试与 Worker 集成测试覆盖边缘与应用层；生产仍必须在 Cloudflare/WAF 层配置分布式速率限制（见待验证项）。

### SEC-004 — Low — CSP 允许 `unsafe-eval`

- Location: `next.config.ts:29`, `worker/index.ts:31`
- Evidence: 原 policy 为 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`。
- Impact: 一旦出现脚本注入，`unsafe-eval` 会扩大攻击面。
- Fix: 移除 `unsafe-eval`，保留当前 SSR 框架需要的 `unsafe-inline`。后续应为 SSR 响应引入 nonce，以进一步移除 `unsafe-inline`。

## 审计结论与待验证项

### SEC-005 — Medium — 内存限流器不是跨 Worker 实例的全局保护

- Location: `src/security/rate-limit.ts:20-72`, `worker/index.ts:42-46`
- Evidence: 配额状态保存在进程内 `Map`；Cloudflare 的多个 isolate 不共享此状态。
- Impact: 高并发攻击可跨 isolate 绕过应用级计数，仍消耗模型 API 配额。
- Required production control: 在 Cloudflare WAF/Rate Limiting Rules 对 `/api/chat*` 设置基于 IP 的全局速率规则，并为 provider 设置独立的账户级预算与告警。此项需要部署控制台权限，无法仅由仓库代码证明。

### SEC-006 — Low — CSP 仍含 `unsafe-inline`

- Location: `next.config.ts:29`, `worker/index.ts:31`
- Required production control: 若 vinext/Next 的生成结果支持，采用每请求 nonce（而非静态 header）并验证构建输出所有脚本均携带 nonce；不能仅通过静态配置安全移除。

## 检查证据

- 输入：聊天请求有 4,000 字符/12,000 总字符限制、7.5 MB 流式上限，反馈有 16 KB 上限；解析使用 `Reflect.get`，不会把 `__proto__` 合并到业务对象。
- XSS：未找到 `dangerouslySetInnerHTML`、`innerHTML`、`document.write`、`eval` 或 `new Function`；用户与模型文本经 React 转义渲染，模型输出还会剥离 HTML 和危险协议。
- CORS：代码未返回 `Access-Control-Allow-Origin`，因此 API 维持同源浏览器策略；接口无 cookie 身份状态，未发现 CSRF 状态修改面。
- 密钥：模型密钥只在服务端的 `providerConfigFromEnvironment` 使用；没有 `NEXT_PUBLIC_*` 密钥；`.env`、`.env.local` 与 `.env.*.local` 已被 `.gitignore` 忽略且未被 Git 跟踪。
- Prompt injection：系统提示明确把用户历史和图片文字标为不可信数据，历史内容以 JSON 字符串边界序列化；模型输出经过接地与文本清理。该措施降低风险，但不能替代模型供应商侧的隔离与监控。
- 依赖：`npm audit` 因当前 registry 的审计接口不可用/锁文件树被拒绝，未能得到可信的漏洞结果；上线 CI 应使用官方 npm registry 的可用 audit 或 Dependabot/Snyk 作为强制检查。
