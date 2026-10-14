module.exports = async function handler(req, res) {
  console.log("TEST 1: started");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const apiKey = process.env.RUNPOD_API_KEY;

  console.log("TEST 2: API key exists:", !!apiKey);

  if (!apiKey) {
    return res.status(500).json({
      error: "RUNPOD_API_KEY is not configured."
    });
  }

  try {
    console.log("TEST 3: before RunPod fetch");

    const response = await fetch(
      "https://api.runpod.ai/v2/18lt7ar99rsrfw/run",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          input: {
            action: "h3_generate",
            image: "test",
            prompt: "test",
            width: 768,
            height: 736,
            length: 124,
            steps: 8,
            seed: 12345
          }
        })
      }
    );

    console.log("TEST 4: RunPod HTTP status:", response.status);

    const responseText = await response.text();

    console.log("TEST 5: RunPod response:", responseText);

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

    return res.status(200).json({
      runpod_status: response.status,
      response: data
    });

  } catch (error) {
    console.error("TEST ERROR:", error);

    return res.status(500).json({
      error: error.message || "RunPod connection failed"
    });
  }
};
