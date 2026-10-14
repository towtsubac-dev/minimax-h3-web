
export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const { image, prompt } = await request.json();

      if (!image) {
        return Response.json(
          { error: "画像がありません。" },
          { status: 400 }
        );
      }

      const apiKey = process.env.RUNPOD_API_KEY;

      if (!apiKey) {
        return Response.json(
          { error: "RUNPOD_API_KEY is not configured." },
          { status: 500 }
        );
      }

      const runpodResponse = await fetch(
        "https://api.runpod.ai/v2/18lt7ar99rsrfw/runsync",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            input: {
              action: "h3_generate",
              image,
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

      const data = await runpodResponse.json();

      if (!runpodResponse.ok) {
        return Response.json(
          {
            error: "RunPod API error",
            details: data
          },
          { status: 502 }
        );
      }

      if (data.status !== "COMPLETED") {
        return Response.json(
          {
            error: "RunPod job failed",
            details: data
          },
          { status: 500 }
        );
      }

      const outputs = data.output?.outputs || [];

      const video = outputs.find(
        output =>
          output.type === "video" ||
          output.filename?.toLowerCase().endsWith(".mp4")
      );

      if (!video?.data) {
        return Response.json(
          {
            error: "生成された動画が見つかりません。",
            details: data.output
          },
          { status: 500 }
        );
      }

      return Response.json({
        video_url: `data:video/mp4;base64,${video.data}`
      });

    } catch (error) {
      console.error("generate error:", error);

      return Response.json(
        { error: error.message || "サーバーエラー" },
        { status: 500 }
      );
    }
  }
};
