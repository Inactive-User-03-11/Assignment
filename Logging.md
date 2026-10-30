# Node App Observability Stack

Logging, dashboards and alerting for a Node.js (Express + pino) app, running in Docker Compose.

```
my-app ──stdout JSON──► Docker ──► Alloy ──► Loki ──► Grafana ──► Slack alerts
                                                         ▲
                                       grafana-mcp (optional, for AI clients)
```

| Component | Role | Port |
|---|---|---|
| `app` | Express app that writes structured JSON logs (pino) | 3001 |
| `alloy` | Collects container logs from the Docker socket, ships to Loki | 12345 |
| `loki` | Log storage and LogQL query engine | 3100 |
| `grafana` | Dashboards and alert rules (provisioned from files) | 3000 |
| `grafana-mcp` | Optional MCP server so AI clients can query Grafana and Loki | 8000 (localhost only) |

## Project layout

```
.
├── docker-compose.yml
├── .env                                   # secrets, NOT committed
├── alloy/config.alloy
├── loki/loki-config.yaml
├── scripts/create-mcp-token.sh            # optional, for grafana-mcp
└── grafana/
    ├── dashboards/
    │   └── node-app-overview.json         # dashboard definition
    └── provisioning/
        ├── datasources/loki.yaml          # Loki datasource (uid: loki)
        ├── dashboards/dashboards.yaml     # tells Grafana where dashboards live
        └── alerting/
            ├── contact-points.yaml        # Slack
            ├── policies.yaml              # routing and repeat intervals
            └── rules.yaml                 # the alert rules
```

## Prerequisites

- Docker and Docker Compose v2
- The app image `web:latest` built locally (the compose file expects it)
- A Slack incoming webhook URL (alerts are sent there)
- `curl` and `jq` (only for the MCP token script)

## Quick start

1. Create a `.env` file next to `docker-compose.yml`:

   ```bash
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
   ```

   Make sure `.env` is in `.gitignore`.

2. Start the stack:

   ```bash
   docker compose up -d
   ```

3. Check everything is running:

   ```bash
   docker compose ps
   docker compose logs grafana | grep -iE "error|provision"
   ```

4. Open Grafana at <http://localhost:3000> (default login `admin` / `admin`, change it on first login).
   - Dashboard: **Dashboards → Node App → Node App - Overview**
   - Alerts: **Alerting → Alert rules** (four rules in the `Node App` folder)

If you run this in GitHub Codespaces, open Grafana through the forwarded port 3000 in the **Ports** tab.

## Generate some traffic

```bash
for i in $(seq 1 30); do curl -s localhost:3001/success > /dev/null; done   # 200s
for i in $(seq 1 5);  do curl -s localhost:3001/nope    > /dev/null; done   # 404s
for i in $(seq 1 10); do curl -s localhost:3001/error   > /dev/null; done   # 500s
```

Within about a minute the dashboard shows the requests, status classes and latency.
`/health` is deliberately excluded from logs.

## Alerts

All rules are evaluated every minute against Loki (LogQL) and route to Slack.

| Alert | Fires when | Severity |
|---|---|---|
| High 5xx rate | more than 5 responses with status >= 500 in 5 minutes | critical |
| Fatal error | any log with `level="fatal"` in 5 minutes | critical |
| Restarted | more than one `server started` log in 15 minutes | warning |
| High p95 latency | p95 `responseTime` above 500 ms for 5 minutes | warning |

**Test the 5xx alert:** run the `/error` loop above. The alert goes Pending, then Firing after about 2 minutes, and a Slack message follows.
You can also use **Contact points → Test** in Grafana to check the webhook on its own.

Rules, contact points and policies are provisioned from files, so they are read-only in the Grafana UI.
To change them, edit the YAML under `grafana/provisioning/alerting/` and restart Grafana:

```bash
docker compose restart grafana
```

## Log format the queries rely on

The app logs one JSON object per line (pino / pino-http). The queries use these fields:

| Field | Meaning |
|---|---|
| `level` | `info`, `warn`, `error`, `fatal` |
| `msg` | `request completed` (2xx to 4xx) or `request errored` (5xx) |
| `req.method`, `req.url` | flattened by LogQL as `req_method`, `req_url` |
| `res.statusCode` | flattened as `res_statusCode` |
| `responseTime` | request duration in ms |

Alloy labels every log stream with `container` (the container name), so queries start with `{container="my-app"}`.
If you rename the container, update the dashboard JSON and `rules.yaml`.

Example query in Grafana Explore:

```logql
{container="my-app"} | json | res_statusCode >= 500
```

## Optional: Grafana MCP server

Lets an AI client (Claude Code, VS Code, Cursor) query Grafana and Loki in plain English.
It is behind a Compose profile, so it does not start with the normal `up`.

1. Make sure Grafana is up, then create a read-only service account token:

   ```bash
   chmod +x scripts/create-mcp-token.sh
   ./scripts/create-mcp-token.sh        # appends GRAFANA_MCP_TOKEN to .env
   ```

   If you changed the Grafana admin password:
   `GRAFANA_ADMIN=admin:yourpass ./scripts/create-mcp-token.sh`

2. Start the MCP server:

   ```bash
   docker compose --profile mcp up -d grafana-mcp
   docker compose logs grafana-mcp
   ```

3. Connect a client:

   ```bash
   claude mcp add --transport http grafana http://localhost:8000/mcp
   ```

   For VS Code, add to `.vscode/mcp.json`:

   ```json
   { "servers": { "grafana": { "type": "http", "url": "http://localhost:8000/mcp" } } }
   ```

4. Try: "Query Loki for error logs from my-app in the last hour and summarise them."

Security notes: the endpoint has no login and the token is baked into the container, so it is bound to `127.0.0.1` only.
In Codespaces keep port 8000 **Private**. The token has the Viewer role (read-only).
If you regenerate the token, re-run the `docker compose --profile mcp up -d grafana-mcp` command.

## Common operations

```bash
docker compose logs -f app            # follow app logs
docker compose logs -f alloy          # check log shipping
docker compose restart grafana        # reload provisioning changes
docker compose down                   # stop (keeps data)
docker compose down -v                # stop and delete Loki and Grafana data
```

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker compose up` says "set SLACK_WEBHOOK_URL in .env" | `.env` is missing or not next to the compose file |
| Dashboard is not listed in Grafana | `dashboards.yaml` must be in `grafana/provisioning/dashboards/`, and the JSON in `grafana/dashboards/` |
| Panels show "No data" | Generate traffic. Check Alloy is running (`docker compose logs alloy`) and that logs appear in Explore for `{container="my-app"}` |
| Alert rules missing | Check `docker compose logs grafana` for provisioning errors, usually YAML indentation or an empty `SLACK_WEBHOOK_URL` |
| Alert fires but no Slack message | Wrong webhook URL. Use **Contact points → Test** |
| 5xx alert never fires | Queries must match both `request completed` and `request errored` (the stock rules already do) |
| MCP returns 401/403 | `GRAFANA_MCP_TOKEN` in `.env` is empty or stale. Re-run the token script, then recreate `grafana-mcp` |
| Datasource error after upgrading the datasource file | Loki now has a fixed `uid: loki`. If Grafana complains, run `docker compose down -v` once to start with a clean Grafana volume |

## Limits

- This is logs-only monitoring. If the container is killed without logging anything, no log-based alert can detect it. For uptime alerting, add a blackbox probe on `/health` or container metrics (cAdvisor + Prometheus).
- Loki stores data on a local volume (`loki_data`) and is configured for a single node. It is meant for development and small deployments.