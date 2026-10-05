FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY config.py db.py jobs.py main.py risk_runner.py ./
COPY engine ./engine
COPY sources ./sources
COPY data ./data
RUN useradd --create-home app
USER app
# Cloud Run sets $PORT (default 8080)
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
