# التطبيق الرئيسي — MCP Media Generator (Next.js 16 standalone)
# ملاحظة: خدمة دمج الفيديو لها Dockerfile خاص داخل merger-service/
FROM node:22-slim

WORKDIR /app

# الاعتماديات أولًا للاستفادة من طبقة الكاش
COPY package.json ./
RUN npm install --no-audit --no-fund

# الكود ثم البناء (next build + تجهيز النسخة المستقلة)
COPY . .
RUN npm run build:local

ENV NODE_ENV=production
# حرِج جدًا: Docker يضبط HOSTNAME بمعرّف الحاوية فيرتبط السيرفر المستقل به بدل 0.0.0.0
# ولا يصل إليه بروكسي المنصة (502). نضبطه صراحةً على 0.0.0.0.
ENV HOSTNAME=0.0.0.0
# المنصة (Render) تضبط PORT — السيرفر المستقل يقرأ process.env.PORT

CMD ["node", ".next/standalone/server.js"]
