#!/bin/sh
for p in ${E2E_HUB_PORT:-8851} ${E2E_WEB_PORT:-5251} 4101 4102 4103 4104; do lsof -tiTCP:$p -sTCP:LISTEN | xargs kill 2>/dev/null; done
