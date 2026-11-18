# Rehber API. The embedding model (~1.2 GB) is not baked in: mount it at /app/.models
# (docker-compose mounts backend/.models), so it downloads at most once.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app
COPY evals ./evals

# Run as an unprivileged user.
RUN useradd --create-home --uid 1000 rehber && mkdir -p /app/.models /app/storage && chown -R rehber /app
USER rehber

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

# Apply database migrations, then serve. The API is only reachable inside the Docker network.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-server-header"]
