module.exports = async function handler(req, res) {
  console.log("STATUS 1: started");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const jobId = req.query?.job_id;
  const model = req.query?.model || "h3";
  const erosEndpoint = process.env.VERCEL_ENV === "preview" && ["feature/eros-lora-library", "feature/r2-only-eros-loras", "feature/shared-h3-eros-lora-library"].includes(process.env.VERCEL_GIT_COMMIT_REF) ? "qdu7le19os7loq" : "2gdf5g88h8jsmm";
  const h3Endpoint = process.env.VERCEL_ENV === "preview" && process.env.VERCEL_GIT_COMMIT_REF === "feature/shared-h3-eros-lora-library" ? "h3uc7tx9jxa2vc" : "18lt7ar99rsrfw";
  const endpointIds = { h3: h3Endpoint, erosmax: erosEndpoint, erosmax_extend: erosEndpoint };
  if (!Object.prototype.hasOwnProperty.call(endpointIds, model)) {
    return res.status(400).json({ error: "モデル指定が不正です。" });
  }

  console.log("STATUS 2: job_id:", jobId);

  if (!jobId) {
    return res.status(400).json({
      error: "job_id is required"
    });
  }

  const apiKey = process.env.RUNPOD_API_KEY;

  console.log(
    "STATUS 3: API key exists:",
    !!apiKey
  );

  if (!apiKey) {
    return res.status(500).json({
      error: "RUNPOD_API_KEY is not configured."
    });
  }

  try {
    console.log("STATUS 4: before RunPod fetch");

    const response = await fetch(
      `https://api.runpod.ai/v2/${endpointIds[model]}/status/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      }
    );

    console.log(
      "STATUS 5: RunPod HTTP status:",
      response.status
    );

    const responseText = await response.text();

    console.log(
      "STATUS 6: RunPod response:",
      responseText
    );

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: "RunPodからJSONではないレスポンスが返りました。",
        runpod_status: response.status,
        response: responseText
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        error: "RunPod status API error",
        runpod_status: response.status,
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("STATUS ERROR:", error);

    return res.status(500).json({
      error: error.message || "Status check failed"
    });
  }
};
