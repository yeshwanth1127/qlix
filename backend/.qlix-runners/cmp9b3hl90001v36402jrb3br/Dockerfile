FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LUNA_BROWSER_HEADLESS=1

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates fonts-liberation \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libgbm1 libasound2 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*
COPY sdk/python /app/sdk/python
RUN pip install --no-cache-dir -e "/app/sdk/python[browser]"
RUN python -m playwright install chromium
COPY backend/.qlix-runners/cmp9b3hl90001v36402jrb3br/adk /app/adk
CMD ["python", "-m", "qlix.cloud_runner"]
