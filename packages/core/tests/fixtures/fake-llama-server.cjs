#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");

const value = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const host = value("--host", "127.0.0.1");
const port = Number(value("--port", "8080"));
const alias = value("--alias", "qwen");
const events = process.env.HACKL_FAKE_EVENTS;

if (process.env.HACKL_FAKE_EXIT === "1") process.exit(7);

const record = (event) => {
  if (events) fs.appendFileSync(events, `${event} ${process.pid}\n`);
};

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200);
    response.end("ok");
    return;
  }
  if (request.url === "/v1/models") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: alias }] }));
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

server.listen(port, host, () => record("start"));
const shutdown = () => server.close(() => {
  record("stop");
  process.exit(0);
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
