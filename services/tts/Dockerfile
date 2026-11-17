ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-dev build-essential git ca-certificates \
        ffmpeg sox libsox-dev libsox-fmt-all libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# The official cu130 wheels ship sm_120 kernels and compute_120 PTX, which run on GB10 (sm_121).
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
RUN python3 -m venv /opt/torch \
    && /opt/torch/bin/pip install --index-url "$TORCH_INDEX" torch==2.9.0 torchaudio==2.9.0

COPY constraints.txt install-engine.sh /opt/
COPY engines/chatterbox.* /opt/engine-requirements/
RUN sh /opt/install-engine.sh chatterbox
COPY engines/qwen3.* /opt/engine-requirements/
RUN sh /opt/install-engine.sh qwen3
COPY engines/omnivoice.* /opt/engine-requirements/
RUN sh /opt/install-engine.sh omnivoice
COPY engines/f5.* /opt/engine-requirements/
RUN sh /opt/install-engine.sh f5

RUN python3 -m venv /opt/server \
    && /opt/server/bin/pip install fastapi==0.124.4 "uvicorn[standard]==0.33.0" httpx==0.28.1

WORKDIR /app
COPY server.py worker.py /app/

EXPOSE 9010
CMD ["/opt/server/bin/python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9010", "--workers", "1"]
