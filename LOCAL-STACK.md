# 芯链采购平台本地架构与观测

这套本地栈把供应链平台、采购 Agent、MCP、MySQL、Redis、RabbitMQ、OpenTelemetry、Prometheus、Tempo、Grafana 与独立可观测性中心组合成一个可演示的完整系统。

## 已落地能力

- Redis cache-aside 缓存物料、供应商和库存热点数据；热点库存写入使用带 TTL 的分布式锁，Redis 异常时退化到数据库原子更新。
- 库存同时使用 `version` 乐观锁与 `current_quantity >= quantity` 条件扣减，避免并发覆盖和超卖。
- 订单创建支持 `Idempotency-Key`：相同键和相同内容复用首次结果，相同键和不同内容直接拒绝。
- 领域事件和 `outbox_event` 在同一 MySQL 事务落库，再通过 Publisher Confirm 投递 RabbitMQ Topic Exchange；业务队列持久化，失败指数退避，消费端用数据库唯一键去重，重试耗尽进入 DLQ。
- Agent 到 ERP 传播 `X-Trace-Id` 与 W3C `traceparent`；Java 与 FastAPI 通过 OTLP 上报到 Collector，再写入 Tempo。
- Prometheus 采集 Java/Micrometer 与 Agent 指标；Grafana 自动装载“芯链采购平台 · Agent 与业务稳定性”看板。
- Agent 指标包含耗时、首 Token、成功率、活跃请求、工具调用、输入/输出 Token 与可配置价格下的估算成本。
- 创建订单接口带共享限流；MCP HTTP 客户端有分段超时、指数退避、5 次失败熔断 30 秒，只有幂等写请求允许重试。

## 一键启动

先按 [README](README.md#仓库布局与依赖) 将三个仓库克隆到同一级目录，再进入本仓库根目录执行以下步骤。

1. 将 `.env.example` 复制为 `.env`，填写所有必填项。`DECISION_DB_PASSWORD` 与
   `EVALUATION_DB_PASSWORD` 使用两个不同的随机值，`MCP_INVOCATION_SIGNING_SECRET` 至少
   32 字节；不要把 `.env` 提交到仓库。
2. 按需设置 `APP_CAPABILITY_BOOTSTRAP=reviewer=evaluation:view,maintainer=evaluation:view|evaluation:maintain`。
3. 执行 `docker compose config`，确认必填变量齐全且渲染配置中没有意外 ERP 凭据进入
   `evaluation-worker`。
4. 在本目录执行 `docker compose up --build -d`。
5. 使用 `docker compose ps` 和
   `docker compose logs -f agent-schema-init decision-db-bootstrap erp agent-api mcp evaluation-worker`
   查看状态。

`agent-schema-init` 使用部署数据库管理员创建加法表后即退出；`decision-db-bootstrap` 随后只向
`chipchain_mcp` 授予决策/事件/claim 所需权限，只向 `chipchain_evaluation` 授予评测队列与结果表
所需权限。worker 不配置 `JAVA_API_*`、`ERP_MCP_URL` 或 `ERP_API_TOKEN`，工作流订单调用只进入
模拟器。首次注册 bootstrap 名单中的用户后，重启 `agent-api` 一次以应用授权。

Windows 上已分别启动 Agent API（8090）和 ERP（8082）时，可单独接入观测：

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\start-observability.ps1
```

该命令下载并校验 Prometheus，使用本机采集配置启动 `9090`，并在 `3002`
启动带指标代理的看板。数据和日志保存在 `%LOCALAPPDATA%\ChipSupply\observability`。
普通 `python -m http.server` 不支持看板需要的 `/prometheus/` 代理，请先停止旧静态服务器。

启动后访问：

- 供应链平台：<http://localhost:8082>
- 采购助手：<http://localhost:3000>
- Agent 指标：<http://localhost:8090/metrics>
- ERP 指标：<http://localhost:8082/actuator/prometheus>
- Prometheus：<http://localhost:9090>
- Grafana：<http://localhost:3001>，看板位于“芯链采购平台”目录
- 可观测性中心：<http://localhost:3002>，分别展示实时运行指标与持久化“决策质量”评测证据
- RabbitMQ 管理台：<http://localhost:15672>
- Trace：在 Grafana Explore 中选择 Tempo，根据 Trace ID 查询

Redis 仅承担缓存与热点库存锁。Redis、RabbitMQ 或监控组件短时不可用不会阻断订单、库存等核心业务；待投递事件保留在 MySQL Outbox，RabbitMQ 恢复后继续发布。

## 决策质量演示

登录采购助手后，在浏览器保持同一主机名（建议都使用 `localhost`），再打开可观测性中心并切换
“决策质量”。HttpOnly 登录 Cookie 的路径为 `/api`，浏览器会将它发给同源质量代理；Nginx
只允许 GET/HEAD，并返回 `Cache-Control: no-store`。

默认套件与本地/CI 运行命令见 Agent 仓库 `docs/evaluation-system.md`。创建运行后，
`evaluation-worker` 从 MySQL 原子领取任务并增量写入场景结果。页面应显示 suite/version、环境、
状态、每项指标分子/分母、当前基线和场景钻取。停止 Prometheus 或 Tempo 后刷新页面，相应实时
链接显示不可用，但已存评测报告继续显示。
