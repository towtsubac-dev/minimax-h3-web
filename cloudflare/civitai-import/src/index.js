// Isolated Worker scaffold. Import is intentionally disabled until the
// signed-request protocol and end-to-end test are implemented.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "civitai-r2-import",
        r2_binding: Boolean(env.LORA_BUCKET),
        signing_secret_configured: Boolean(env.LORA_IMPORT_SIGNING_SECRET),
        import_enabled: false
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Import is not enabled" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
};
