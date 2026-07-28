# Blum Agent

Blum Agent 是一个中文优先的百隆五金专业助手，服务设计师、销售、安装工、生产、采购和消费者。它用官方资料检索为模型回答提供上下文，对型号、孔位、承重、兼容性与最终下单等高风险问题主动要求复核。

## 核心能力

- 六类用户角色与对应的任务入口
- AVENTOS、铰链、抽屉、导轨、动感开合、REVEGO、内分隔、柜体应用和加工设备知识路由
- 官方来源卡片与回答置信状态
- JPG、PNG、WebP 现场图片辅助识别
- OpenAI-compatible Chat Completions 模型接口
- 无模型配置时透明降级到官方资料导航模式
- Cloudflare Worker / OpenAI Sites 部署

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .env.example .env.local
npm run dev
```

在 `.env.local` 中配置：

```dotenv
PROVIDER_BASE_URL=https://your-provider.example
PROVIDER_API_KEY=replace-with-your-secret
PROVIDER_MODEL=your-model
```

模型凭证只在服务端读取，禁止提交 `.env.local`。

## 质量门禁

```bash
npm run check
npm test
```

`npm run check` 依次运行 TypeScript、ESLint 和单元/组件测试；`npm test` 执行生产构建并直接调用构建后的 Worker 验证页面与 API。

## 回答边界

Blum Agent 不冒充 Blum 官方，也不承诺价格、库存、交期或授权关系。精确 BOM、产品编号、加工尺寸、承重、电气和安全结论必须用当前市场的官方配置器、订购资料或 Blum 联系渠道复核。

架构决策见 [产品与技术设计](docs/plans/2026-07-23-blum-agent-design.md)，知识入口及维护规则见 [官方资料清单](docs/official-sources.md)。
