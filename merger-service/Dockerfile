# خدمة دمج الفيديو — Video Merger API v2 (ffmpeg)
# بناء:  docker build -t video-merger .
# تشغيل: docker run -p 8787:8787 -v merger-data:/app/data video-merger
FROM node:22-slim

# ffmpeg + ffprobe مطلوبان للدمج الفعلي
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs ./server.mjs

ENV PORT=8787 \
    MERGER_DATA_DIR=/app/data
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 8787
CMD ["node", "server.mjs"]
