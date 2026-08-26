import { createServer } from "node:http";

const host = process.env.LOCAL_AI_MOCK_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.LOCAL_AI_MOCK_PORT ?? "4010", 10);
const maxBodyBytes = 16 * 1024 * 1024;
const suggestion = {
  title: "本地测试：颜色去旅行",
  description:
    "这是一条完全由本地模拟服务生成的固定策展介绍，用于验证界面、错误处理与数据流程；它不会分析图片，也不会上传、推断或保留任何儿童内容，发布前仍需由家长审核。",
  tags: ["本地测试", "模拟建议", "待审核"],
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("LOCAL_AI_MOCK_PORT must be a valid TCP port.");
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "kids-museum-local-ai" });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "Route not found." } });
    return;
  }

  let bodySize = 0;
  let body = "";
  let rejected = false;

  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    bodySize += Buffer.byteLength(chunk);
    if (bodySize > maxBodyBytes) {
      if (!rejected) {
        rejected = true;
        sendJson(response, 413, { error: { message: "Request body is too large." } });
      }
      return;
    }
    body += chunk;
  });

  request.on("end", () => {
    if (rejected) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(response, 400, { error: { message: "Request body must be JSON." } });
      return;
    }

    sendJson(response, 200, {
      id: "chatcmpl-kids-museum-local",
      object: "chat.completion",
      created: 0,
      model:
        typeof payload.model === "string" && payload.model
          ? payload.model
          : "kids-museum-local-mock",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify(suggestion),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  });
});

server.listen(port, host, () => {
  console.log(`Local AI mock listening on http://${host}:${port}/v1`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
