#!/usr/bin/env node

const apiKey = process.env.RUNPOD_API_KEY;
if (!apiKey) {
  console.error("Missing RUNPOD_API_KEY");
  process.exit(1);
}

const imageUrl =
  process.env.SMOKE_IMAGE_URL ||
  "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Wilhelmshaven_Hafen.jpg/640px-Wilhelmshaven_Hafen.jpg";

const jobs = [
  {
    name: "wan-2-6-t2v",
    endpoint: "wan-2-6-t2v",
    payload: { prompt: "cinematic aerial drone shot over ocean at sunset", duration: 5, enable_safety_checker: false },
  },
  {
    name: "wan-2-6-i2v",
    endpoint: "wan-2-6-i2v",
    payload: {
      prompt: "camera slowly pushes in with natural motion",
      image_url: imageUrl,
      duration: 5,
      enable_safety_checker: false,
    },
  },
  {
    name: "flux-kontext-dev",
    endpoint: "black-forest-labs-flux-1-kontext-dev",
    payload: {
      prompt: "turn this image into a futuristic neon cityscape",
      image_url: imageUrl,
      enable_safety_checker: false,
    },
  },
  {
    name: "qwen-image-edit",
    endpoint: "qwen-image-edit",
    payload: {
      prompt: "convert this image into watercolor style",
      image_url: imageUrl,
      enable_safety_checker: false,
    },
  },
];

const request = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return { response, data };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pollJob = async (endpoint, id) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { response, data } = await request(`https://api.runpod.ai/v2/${endpoint}/status/${id}`);
    if (!response.ok) return { status: "FAILED", error: JSON.stringify(data), raw: data };
    const status = String(data.status || "UNKNOWN");
    if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status)) {
      return { status, error: data.error || null, raw: data };
    }
    await wait(2500);
  }

  return { status: "TIMED_OUT", error: "Polling timeout in smoke script", raw: {} };
};

const main = async () => {
  for (const job of jobs) {
    console.log(`\n=== ${job.name} ===`);
    const { response, data } = await request(`https://api.runpod.ai/v2/${job.endpoint}/run`, {
      method: "POST",
      body: JSON.stringify(job.payload),
    });

    if (!response.ok || !data.id) {
      console.log(`submit failed: ${response.status}`);
      console.log(data);
      continue;
    }

    console.log(`submitted id=${data.id} initialStatus=${data.status}`);
    const terminal = await pollJob(job.endpoint, data.id);
    console.log(`terminal=${terminal.status}`);
    if (terminal.error) {
      console.log(`error=${terminal.error}`);
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
