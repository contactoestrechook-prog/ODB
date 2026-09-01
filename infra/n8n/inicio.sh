#!/bin/sh
mkdir -p /home/node/.n8n
chown -R node:node /home/node/.n8n
exec su node -s /bin/sh -c "n8n"
