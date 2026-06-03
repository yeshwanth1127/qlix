FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY sdk/python /app/sdk/python
RUN pip install --no-cache-dir -e /app/sdk/python
COPY backend/.qlix-runners/cmp2fhvzb0001v32g8q56jolb/adk /app/adk
CMD ["python", "-m", "qlix.cloud_runner"]
