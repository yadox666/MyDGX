#!/bin/sh
set -eu
engine="$1"
spec="/opt/engine-requirements/$engine.txt"
python3 -m venv "/opt/engines/$engine"
echo /opt/torch/lib/python3.12/site-packages \
  > "/opt/engines/$engine/lib/python3.12/site-packages/mydgx_torch.pth"
"/opt/engines/$engine/bin/pip" install -c /opt/constraints.txt -r "$spec"
if [ -f "/opt/engine-requirements/$engine.nodeps" ]; then
  "/opt/engines/$engine/bin/pip" install -c /opt/constraints.txt --no-deps \
    -r "/opt/engine-requirements/$engine.nodeps"
fi
"/opt/engines/$engine/bin/python" -c \
  "import torch, torchaudio; assert torch.__version__.startswith('2.9.0'), torch.__version__"
