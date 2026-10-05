FROM python:3.12-slim

# Hugging Face Spaces runs containers as a non-root user with uid 1000.
RUN useradd -m -u 1000 user
USER user
ENV PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

# CPU-only PyTorch (~200 MB) instead of the default CUDA build (~2 GB).
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .

# Alerts are kept in SQLite; /tmp is writable and is reset whenever the Space restarts.
ENV CAN_DB_PATH=/tmp/can_app.db

EXPOSE 7860
CMD ["uvicorn", "main:app", "--app-dir", "ml_service", "--host", "0.0.0.0", "--port", "7860"]
