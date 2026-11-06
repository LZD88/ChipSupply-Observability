# 芯链可观测性中心

面向芯片采购平台的独立运行态看板。页面通过 Nginx 同源代理调用 Prometheus HTTP API，展示可理解的聚合指标，而不是直接暴露原始 `/metrics` 文本。

## 看板内容

- Agent 成功率、P95 请求耗时、首 Token 延迟与活跃请求
- 输入/输出 Token 速率、累计模型成本与历史趋势
- ERP 吞吐、MySQL Outbox 发布结果
- RabbitMQ Ready、Unacked、消费者、队列积压与死信
- ERP、Agent API、RabbitMQ、Prometheus 服务状态
- `MySQL Outbox → RabbitMQ → 幂等消费者 → DLQ` 事件链路
- Trace ID 到 Grafana Tempo 的查询入口

## 仓库布局与依赖

将 Agent、ERP 与本仓库克隆到同一级目录。ERP 使用下面指定的本地目录名，Compose 按该路径构建：

```shell
git clone https://github.com/LZD88/ChipChain-Procurement-Agent.git
git clone https://github.com/LZD88/ChipSupply-Procurement-Platform.git ChipSupply-Teaching-Platform
git clone https://github.com/LZD88/ChipSupply-Observability.git
cd ChipSupply-Observability
```

运行完整栈前，将 `.env.example` 复制为 `.env` 并填写凭据，详见 [本地栈说明](LOCAL-STACK.md)。
模型密钥和本机 `.env` 不应提交到 Git。OpenSandbox 按环境单独提供服务地址。

## 运行

从本仓库根目录执行 `docker compose up --build -d`，访问 <http://localhost:3002>。RabbitMQ 管理台为 <http://localhost:15672>，Grafana 为 <http://localhost:3001>。

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
