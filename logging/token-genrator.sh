#!/usr/bin/env bash
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
AUTH="${GRAFANA_ADMIN:-admin:admin}"      # change if you changed the admin password

SA_ID=$(curl -sf -u "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$GRAFANA_URL/api/serviceaccounts" \
  -d '{"name":"mcp","role":"Viewer"}' | jq -r .id)

TOKEN=$(curl -sf -u "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$GRAFANA_URL/api/serviceaccounts/$SA_ID/tokens" \
  -d '{"name":"mcp-token"}' | jq -r .key)

echo "GRAFANA_MCP_TOKEN=$TOKEN" >> .env
echo "Token written to .env"