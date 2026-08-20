FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# El modelo viaja ADENTRO de la imagen. Si se bajara al arrancar, el primer
# audio del día esperaría medio minuto y cada redeploy volvería a bajar 500 MB.
ENV MODELOS_DIR=/modelos
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8', download_root='/modelos')"

COPY app.py .

# Railway define PORT; 8080 es solo para correrlo a mano
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}
