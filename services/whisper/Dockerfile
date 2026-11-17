ARG BASE_IMAGE=nvcr.io/nvidia/pytorch:25.09-py3
FROM ${BASE_IMAGE} AS ctranslate2

ARG CTRANSLATE2_VERSION=v4.9.0
ENV DEBIAN_FRONTEND=noninteractive
# PyPI only publishes CPU wheels of CTranslate2 for aarch64.
RUN git clone --depth 1 --branch ${CTRANSLATE2_VERSION} --recursive --shallow-submodules \
        https://github.com/OpenNMT/CTranslate2.git /src/ctranslate2 \
    && cmake -S /src/ctranslate2 -B /src/build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/ctranslate2 \
        -DCMAKE_POLICY_DEFAULT_CMP0146=OLD \
        -DWITH_CUDA=ON -DWITH_CUDNN=ON \
        -DCUDA_ARCH_LIST="12.0+PTX" \
        -DWITH_MKL=OFF -DWITH_RUY=ON -DOPENMP_RUNTIME=COMP \
        -DBUILD_CLI=OFF \
    && cmake --build /src/build --parallel \
    && cmake --install /src/build \
    && cd /src/ctranslate2/python \
    && PIP_CONSTRAINT= CTRANSLATE2_ROOT=/opt/ctranslate2 python -m pip wheel --no-deps --no-build-isolation -w /wheels .

FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LD_LIBRARY_PATH=/opt/ctranslate2/lib:${LD_LIBRARY_PATH}

COPY --from=ctranslate2 /opt/ctranslate2 /opt/ctranslate2
COPY --from=ctranslate2 /wheels /wheels

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && PIP_CONSTRAINT= python -m pip install --no-cache-dir \
        openai-whisper==20250625 \
        fastapi==0.124.4 \
        "uvicorn[standard]==0.33.0" \
        python-multipart==0.0.20 \
        transformers==4.57.3 \
        av==15.1.0 \
        onnxruntime==1.23.2 \
        /wheels/ctranslate2-*.whl \
    && PIP_CONSTRAINT= python -m pip install --no-cache-dir --no-deps faster-whisper==1.2.1 \
    && python -c "import ctranslate2, faster_whisper, transformers"

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 9000
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "1"]
