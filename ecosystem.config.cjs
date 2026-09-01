// PM2 process config for Qlix (this machine / Cloudflare Tunnel).
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   (persist across reboots)

const path = require("path");
const root = __dirname;

module.exports = {
  apps: [
    {
      name: "qlix-backend",
      cwd: path.join(root, "backend"),
      script: "dist/main.js",
      interpreter: "node",
      env_file: path.join(root, "backend/.env"),
      env: {
        PATH: `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin`,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      error_file: path.join(root, "logs/qlix-backend-error.log"),
      out_file: path.join(root, "logs/qlix-backend-out.log"),
      merge_logs: true,
    },
    {
      name: "qlix-frontend",
      cwd: path.join(root, "frontend"),
      script: "node_modules/.bin/next",
      args: "start --hostname 127.0.0.1 --port 3000",
      env_file: path.join(root, "frontend/.env"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      error_file: path.join(root, "logs/qlix-frontend-error.log"),
      out_file: path.join(root, "logs/qlix-frontend-out.log"),
      merge_logs: true,
    },
    {
      name: "qlix-mcp",
      cwd: path.join(root, "qlix-mcp-service"),
      script: "src/index.js",
      interpreter: "node",
      env_file: path.join(root, "qlix-mcp-service/.env"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      error_file: path.join(root, "logs/qlix-mcp-error.log"),
      out_file: path.join(root, "logs/qlix-mcp-out.log"),
      merge_logs: true,
    },
    {
      name: "qlix-whatsapp",
      cwd: path.join(root, "qlix-whatsapp-service"),
      script: "src/index.js",
      interpreter: "node",
      env_file: path.join(root, "qlix-whatsapp-service/.env"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      error_file: path.join(root, "logs/qlix-whatsapp-error.log"),
      out_file: path.join(root, "logs/qlix-whatsapp-out.log"),
      merge_logs: true,
    },
  ],
};
