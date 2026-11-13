# 芯链可观测性中心

新增 `/#releases` 提示词发布观测：读取 MySQL 中的版本、门禁、试用对比和审计，
缺样本或用量明确显示不足。管理操作进入采购助手 `http://localhost:3000/#prompt-releases`。
需要 `prompt:view` 或 `prompt:maintain` 权限，evaluation 权限不自动授予发布查看权限。
代理仅允许明确列出的提示词 GET/HEAD 路径，不接受发布写请求。
Windows 本地使用 Agent 的 `start_web.py` 管理 VirtualBox 沙箱，以及本仓库
`ops/start-observability.ps1` 启动原生看板。下文 Compose 只作独立 Linux 部署参考，勿在本工作区使用 Docker Desktop。

面向芯片采购平台的独立运行态与决策质量中心。Agent观测中心通过同源代理调用 Prometheus；
“评测中心”通过 `/api/evaluations/` 代理读取 Agent MySQL 中的持久化评测报告，并提供受权限控制的评测操作。两者的
数据源、状态和故障提示互相独立。

界面采用深蓝侧栏与浅色工作区，可直接访问 `/#overview` 和 `/#evaluations`，支持浏览器返回及手机布局。
Agent观测中心趋势图分别以百分比、秒显示成功率与 P95；评测中心按运行摘要、质量指标、场景证据、基线变化分区展示。

## 看板内容

- Agent 成功率、P95 请求耗时、首 Token 延迟与活跃请求
- 输入/输出 Token 速率、累计模型成本与历史趋势
- ERP 吞吐、MySQL Outbox 发布结果
- RabbitMQ Ready、Unacked、消费者、队列积压与死信
- ERP、Agent API、RabbitMQ、Prometheus 服务状态
- `MySQL Outbox → RabbitMQ → 幂等消费者 → DLQ` 事件链路
- Trace ID 到 Grafana Tempo 的查询入口
- 离线评测套件/运行/环境/状态、指标分母、基线回归和场景证据钻取

基线比较保留每个场景的全部重复执行，回归条目标明第几次执行；同时显示基线与当前运行的通过数/样本数、通过率，以及重复结果是否有差异。少于两个样本时提示不足以判断波动，缺失执行仍可触发门禁。

## 仓库布局与依赖

将 Agent、ERP 与本仓库克隆到同一级目录。ERP 使用下面指定的本地目录名，Compose 按该路径构建：

```shell
git clone https://github.com/LZD88/ChipChain-Procurement-Agent.git
git clone https://github.com/LZD88/ChipSupply-Procurement-Platform.git ChipSupply-Teaching-Platform
git clone https://github.com/LZD88/ChipSupply-Observability.git
cd ChipSupply-Observability
```

运行完整栈前，将 `.env.example` 复制为 `.env` 并填写凭据，尤其是专用
`DECISION_DB_PASSWORD`、`EVALUATION_DB_PASSWORD` 和至少 32 字节的
`MCP_INVOCATION_SIGNING_SECRET`，详见 [本地栈说明](LOCAL-STACK.md)。
模型密钥和本机 `.env` 不应提交到 Git。OpenSandbox 按环境单独提供服务地址。

## 运行

先执行 `docker compose config` 检查必填变量，再运行 `docker compose up --build -d`，访问
<http://localhost:3002>。侧栏可在“Agent观测中心”和“评测中心”间切换。RabbitMQ 管理台为
<http://localhost:15672>，Grafana 为 <http://localhost:3001>。

Compose 会先运行一次性 `agent-schema-init`，再由 `decision-db-bootstrap` 为 MCP 和评测 worker
建立最小权限账号；`evaluation-worker` 只接收 Agent MySQL 连接，不接收 ERP URL、账号、密码或
Token。`APP_CAPABILITY_BOOTSTRAP` 可赋予 `evaluation:view` / `evaluation:maintain`，留空则默认
拒绝。若目标用户是首次注册，注册后重启一次 `agent-api` 以应用 bootstrap grant。

```dotenv
APP_CAPABILITY_BOOTSTRAP=reviewer=evaluation:view,maintainer=evaluation:view|evaluation:maintain
```

评测响应统一 `no-store`；Nginx 默认只允许 GET/HEAD，创建任务、实验、保存案例、回放、取消和设置基线使用明确的写路径白名单，正文上限 64 KiB，仍由 Agent 校验登录、来源标记和维护权限。决策证据不会写入静态文件或
Prometheus。fixture 结果必须称为“离线/测试证据”，不得表述为线上准确率、节省或 ROI。

无请求样本时，看板显示“等待样本”；不会生成或伪造演示数据。

## Windows 本机运行

Agent API 和 ERP 分别运行于 `8090`、`8082` 时，在本仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\start-observability.ps1
```

启动器首次下载并校验 Prometheus，使用 `ops/prometheus/prometheus.local.yml`
采集本机指标；同时启动带 `/prometheus/` 同源代理的看板服务，访问
<http://localhost:3002>。再次执行会复用已就绪的服务。

二进制、15 天历史数据和日志存放于 `%LOCALAPPDATA%\ChipSupply\observability`。
如需指定 Python，传入 `-PythonPath C:\path\to\python.exe`。
请先停止占用 `3002` 的旧静态服务器，再运行启动器。

看板不能使用 `python -m http.server 3002` 启动，该命令不支持指标代理。
Prometheus 每 10 秒采集一次；速率和 P95 需要采集启动后的新增对话。
RabbitMQ 未启动时会显示不可用，其余服务的指标仍能正常显示。

## 环境准备诊断

实时运行视图新增独立的准备等待 P95（秒）、最近 5 分钟成功等待约算样本数，以及失败、超时、取消结果。少于 20 个样本显示“样本较少，直方图估算”；Prometheus `increase` 为外推估计，不代表精确请求条数。

阶段卡片分别显示 sandbox/graph/sync 的 P95，阶段可能嵌套，不能相加或从总耗时相减来推算模型时间。缓存命中率只使用 hit/(hit+miss)，无访问时显示等待样本。池显示 ready/target/creating 和补充失败。旧 Agent 没有新指标时等待样本，Prometheus 不可达时显示不可用；诊断请求独立处理，不阻断其他可用视图和持久化质量数据。原总请求和首 Token 指标保留。

验证：`node --test tests/preparation.test.mjs`。

## 提示词发布观测

访问 `http://localhost:3002/#releases`，使用采购助手同一主机名登录态及 `prompt:view` 权限。
该页只读代理版本、发布状态、门禁、审计和同窗请求观测；所有写方法返回 405，其他 Agent API 不开放。
维护操作进入 `http://localhost:3000/#prompt-releases`，需额外的 `prompt:maintain` 权限。

稳定版、试用版、历史版本、直接回复、旧会话分别统计；完整样本少于 20 显示样本不足，
缺少 usage 显示未知费用。待审批会话列出原版本；401/403/503 会清空旧卡片并提示错误。
发布证据保存在 MySQL，Prometheus 或 Tempo 故障不影响读取；线上明细仅保留 30 天。

验证：`python -m unittest discover -s tests -p 'test_*.py'`、`node --test tests/*.test.mjs`。
登录后在浏览器执行 `tests/browser/releases.js` 检查 11 项状态与交互；脚本仅在当前页拦截测试请求，
结束后恢复真实 API，不创建发布或评测数据。

## 评测工作台

在评测中心选择场景创建任务，查看执行进度、取消运行、下载报告或设为基线；“对比实验”支持模型、提示词和技能的配对对比，历史代码通过已有报告对比，不执行上传的代码。
“回归案例”可保存失败证据，导入本人线上失败问题，并在隔离环境中重复回放三次；完整通过后才标记解决。实验结果不作为提示词发布门禁证据，缺少单价或用量时费用显示未知。
查看需要 `evaluation:view`，操作需要 `evaluation:maintain`。侧栏分为工作空间、应用入口、配置与调用追踪，短窗口中导航独立滚动。
