export default async function handler(req, res) {
  const targetBase = String(process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || "").trim().replace(/\/$/, "");
  if (!targetBase) {
    return res.status(500).json({
      error: "Backend URL not configured",
      hint: "Set BACKEND_URL in frontend Vercel project env vars",
    });
  }

  const path = Array.isArray(req.query?.path) ? req.query.path.join("/") : String(req.query?.path || "");
  const search = req.url && req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `${targetBase}/api/${path}${search}`;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];

  let body = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.body == null) {
      body = undefined;
    } else if (typeof req.body === "string" || req.body instanceof Buffer) {
      body = req.body;
    } else {
      body = JSON.stringify(req.body);
      if (!headers["content-type"]) headers["content-type"] = "application/json";
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (error) {
    return res.status(502).json({
      error: "API proxy failed",
      message: error instanceof Error ? error.message : String(error),
      targetUrl,
    });
  }
}
