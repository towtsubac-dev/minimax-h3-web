export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, prompt } = req.body;

    if (!image) {
      return res.status(400).json({
        error: "画像がありません。"
      });
    }

    const response = await fetch(
      "https://api.runpod.ai/v2/18lt7ar99rsrfw/runsync",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RUNPOD_API_KEY}`
        },
        body: JSON.stringify({
          input: {
            action: "h3_generate",
            image: image,
            prompt: prompt || "",
            width: 768,
            height: 736,
            length: 124,
            steps: 8,
            seed: Math.floor(Math.random() * 1000000000)
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (data.status !== "COMPLETED") {
      return res.status(500).json({
        error: "RunPod job failed",
        details: data
      });
    }

    const outputs = data.output?.outputs || [];

    const video = outputs.find(
      output =>
        output.type === "video" ||
        output.filename?.toLowerCase().endsWith(".mp4")
    );

    if (!video) {
      return res.status(500).json({
        error: "生成された動画が見つかりません。",
        details: data.output
      });
    }

    return res.status(200).json({
      video_url: `data:video/mp4;base64,${video.data}`
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message
    });
  }
}
