/* Minimal Fastify + multipart test server
   Run: node ~/test-multipart-server.js
*/
const Fastify = require("fastify");
const multipart = require("@fastify/multipart");

async function start() {
  const app = Fastify({ logger: true });

  await app.register(multipart, {
    limits: { fileSize: 200 * 1024 * 1024, files: 10 },
    attachFieldsToBody: true,
  });

  app.post("/test-upload", async (req, reply) => {
    req.log.info({ headers: req.headers }, "headers");

    const body = req.body || {};
    req.log.info({ bodyKeys: Object.keys(body) }, "body keys");

    const seen = [];
    if (typeof req.parts === "function") {
      try {
        for await (const part of req.parts()) {
          if (part.file) {
            const chunks = [];
            for await (const c of part.file) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
            seen.push({ field: part.fieldname, filename: part.filename, size: Buffer.concat(chunks).length });
          } else {
            seen.push({ field: part.fieldname, value: part.value });
          }
        }
      } catch (err) {
        req.log.error(err, "parts() error");
        return reply.code(500).send({ ok: false, error: String(err.message || err) });
      }
    } else {
      req.log.info("parts() not available");
    }

    req.log.info({ seen }, "parts seen");
    return reply.send({ ok: true, bodyKeys: Object.keys(body), seen });
  });

  await app.listen({ port: 5010, host: "127.0.0.1" });
  console.log("Test server listening on http://127.0.0.1:5010");
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
