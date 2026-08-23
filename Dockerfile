FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static
COPY templates ./templates
COPY data ./data

RUN mkdir -p /data/logos

ENV FLUXTV_HOST=0.0.0.0 \
    FLUXTV_PORT=8888 \
    FLUXTV_DATABASE=/data/fluxtv.db \
    FLUXTV_DEFAULT_TIMEZONE=America/New_York

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8888"]
