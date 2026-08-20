"""Transcriptor de audios de O.D.B.

NO ESTÁ DESPLEGADO. El dueño eligió pagar OpenAI por uso (centavos por mes)
en lugar de tener este servicio prendido (5-8 dólares por mes), así que el API
apunta a api.openai.com. Esto queda como alternativa lista: si algún día
conviene no depender de un proveedor externo, se levanta como servicio en el
proyecto de Railway y se cambia TRANSCRIPCION_URL. Nada más.

El bot atiende con Claude, que lee texto e imágenes pero NO escucha audio. Este
servicio es el oído: recibe la nota de voz que mandó el cliente por WhatsApp y
devuelve lo que dijo, para que el bot la conteste como a cualquier mensaje.

Habla la misma forma que la API de OpenAI (POST /v1/audio/transcriptions con el
archivo en un formulario), a propósito: si algún día conviene pagar OpenAI o
Groq en lugar de tener esto prendido, se cambia UNA variable en el API
(TRANSCRIPCION_URL) y no se toca una línea de código del bot.

Corre el modelo Whisper localmente sobre CPU. El audio no sale de la
infraestructura de O.D.B.
"""

import os
import tempfile

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

CLAVE = os.environ.get("CLAVE", "")
MODELO = os.environ.get("MODELO", "small")
MODELOS_DIR = os.environ.get("MODELOS_DIR", "/modelos")

# se carga una sola vez al arrancar: cargarlo por pedido agregaría ~10 s a cada
# audio. int8 sobre CPU es lo que entra en un contenedor chico sin GPU.
modelo = WhisperModel(MODELO, device="cpu", compute_type="int8", download_root=MODELOS_DIR)

# vocabulario del negocio: sin esto Whisper escribe "fernet blanca", "quilmes
# cristal" mal cortado y confunde las sucursales
VOCABULARIO = (
    "Pedido de bebidas en Argentina: fernet Branca, Quilmes, Coca Cola, Sprite, Aquarius, "
    "Malbec, espumante, cajón, botella, litro, docena, Canning, Sant Thomas, Santa Inés."
)

app = FastAPI(title="Transcriptor O.D.B")


@app.get("/salud")
def salud():
    return {"ok": True, "modelo": MODELO}


@app.post("/v1/audio/transcriptions")
async def transcribir(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),
    language: str = Form("es"),
    prompt: str = Form(""),
    authorization: str = Header(None),
):
    if CLAVE and authorization != f"Bearer {CLAVE}":
        raise HTTPException(status_code=401, detail="clave inválida")

    datos = await file.read()
    if not datos:
        raise HTTPException(status_code=400, detail="archivo vacío")

    # faster-whisper decodifica desde archivo; el .ogg de WhatsApp (opus) entra
    # sin convertir nada
    sufijo = os.path.splitext(file.filename or "audio.ogg")[1] or ".ogg"
    with tempfile.NamedTemporaryFile(suffix=sufijo, delete=False) as f:
        f.write(datos)
        ruta = f.name
    try:
        segmentos, _info = modelo.transcribe(
            ruta,
            language=(language or "es"),
            initial_prompt=(prompt or VOCABULARIO),
            vad_filter=True,  # descarta los silencios: audios más rápidos y sin inventos
            beam_size=5,
        )
        texto = " ".join(s.text.strip() for s in segmentos).strip()
    finally:
        os.unlink(ruta)

    return {"text": texto}
