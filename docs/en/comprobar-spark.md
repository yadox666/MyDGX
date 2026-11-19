# How to check a DGX Spark before buying it

This guide lets you quickly review a new or used DGX Spark before
accepting it. The test included in MyDGX checks identity, hardware, health, and
basic functions over SSH.

> The result reduces risk, but it doesn't replace the manufacturer's warranty or
> a prolonged load test.

## What you need

- A Mac or Linux machine with this repository downloaded.
- The Spark powered on, with DGX OS booted and connected to the same network.
- The SSH user created during the first boot.
- The advertised SSD capacity: 1 TB or 4 TB.
- Physical access to the console to check the SSH fingerprint.

Before running any software, also inspect the chassis, power supply,
ports, serial number, invoice, and warranty coverage. Don't publish the
serial number.

## Quick test

From the MyDGX folder:

```bash
./start.sh test nvidia@SPARK_IP --interactive --expect-disk-tb 1
```

Replace:

- `nvidia` with the real user;
- `SPARK_IP` with its IP or hostname;
- `1` with `4` if you're buying the version with a 4 TB SSD.

SSH will ask for the password directly in Terminal if there is no valid
key. MyDGX neither receives nor stores that password.

## Sample output

This is a real, anonymized example. It is more useful than a perfect case because
it shows how the test flags issues worth investigating before
buying:

```text
  ┌──────────────────────────────────────────────────────────────────┐
  │  ◆  DGX SPARK                                                   │
  │  Hardware acceptance & health check                             │
  │                                                                  │
  │  nvidia@SPARK_IP:22                                             │
  │  auth  key or terminal prompt                                   │
  └──────────────────────────────────────────────────────────────────┘

  CHECK                 DETAIL                       TIME   STATUS
  ────────────────────────────────────────────────────────────────────
  System
  ────────────────────────────────────────────────────────────────────
  Manufacturer      NVIDIA
  Product           DGX Spark
  Product version   GB10
  DGX OS            NVIDIA DGX OS 7
  Kernel            7.0.0-1025-nvidia
  Arch              aarch64
  CPU               0xd87 · 20 threads
  Memory            118.8 GiB free of 121.7 GiB unified
  Disk /            45.9 GiB used of 3.7 TiB (2%)
  Load              0.31 0.26 0.14
  Uptime            8m
  Address           [REDACTED]
  Host key          SHA256:[REDACTED]  ED25519

  GPU
  ────────────────────────────────────────────────────────────────────
  Name              NVIDIA GB10
  Driver            595.99.02
  Temperature       37 C
  Utilization       0%
  CUDA              13.2
  Memory            unified Grace pool (nvidia-smi shows N/A)

  Storage
  ────────────────────────────────────────────────────────────────────
  Root device       /dev/nvme0n1p2
  Write test        2488 MB/s (256 MiB, synced)
  Read test         11574 MB/s (256 MiB)
  NVMe SMART        PASS:SMART log readable via sudo -n
  NVMe model        SAMSUNG MZALC4T0HBL1-00B07
  Serial / firmware [REDACTED] / NXHB202Q
  NVMe temp         39 C
  Wear / spare      0% used / 100% spare (threshold 10%)
  Power-on time     8d 10h (202h total)
  Controller busy   14h 28m (868m total)
  Power cycles      68 (16 unsafe shutdowns)
  Media errors      0
  Error log entries 0

  Exercises & errors
  ────────────────────────────────────────────────────────────────────
  Memory            PASS:512 MiB allocated and verified
  Disk I/O          PASS:256 MiB write/read completed
  CUDA compute      PASS:NVIDIA GB10
  Max system temp   41 C (acpitz)
  NVIDIA Xid        0
  Boot errors       44

  Notes
  ────────────────────────────────────────────────────────────────────
  · WARN: The current boot journal contains 44 error-level message(s).
  · NVMe lifetime records 16 unsafe shutdown(s); monitor whether this increases.

  ────────────────────────────────────────────────────────────────────
  Result            ATTENTION
  Summary           7 transport checks, 0 failed; 0 hardware failures, 1 warnings
  Elapsed           346s
  Next              Core checks passed, but review the warnings above.
```

In this example, the main brand and model are **NVIDIA DGX Spark / GB10**,
the SSD is a **4 TB Samsung MZALC4T0HBL1-00B07**, and it records **202 hours of
use**. The GPU, CUDA, memory, disk, and SMART pass the tests, with no wear or
media errors. However, the result is `ATTENTION`: there are 44 boot error
messages and 16 unsafe shutdowns. Before buying, you would need to review
`journalctl -b -p 0..3`, repeat the test after a clean reboot, and confirm
that neither counter increases.

A `HEALTHY` result with zero warnings is the desirable baseline. If you see
`ATTENTION`, `WARN`, `FAIL`, or `SKIP`, always review the details.

Before buying, pay special attention to **Manufacturer**, **Product**, the GPU
**Name**, total memory, capacity and **NVMe model**, **Power-on time**,
wear, unsafe shutdowns, media errors, and the final result. Hours of use
should not be confused with `Uptime`: `Power-on time` is the accumulated use
of the SSD, while `Uptime` only measures the time since the last boot.

## Verify the machine's identity first

On the Spark's local console, run:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Copy only the `SHA256:...` fingerprint and pin the test to it:

```bash
./start.sh test nvidia@SPARK_IP \
  --interactive \
  --expect-fingerprint SHA256:VERIFIED_FINGERPRINT \
  --expect-disk-tb 1 \
  --strict
```

Don't accept a fingerprint received over the network without comparing it with
the Spark's console. For a rented or freshly reinstalled unit there is also
`--accept-new`, but you must verify the fingerprint first.

## Automatic discovery on a local network

If you don't know the address:

```bash
./start.sh test --autodiscover
```

The assistant looks for SSH services advertised as DGX, Spark, or NVIDIA and
creates a local configuration in:

```text
config/dgx-health-check/dgx-spark.env
```

That file has `0600` permissions and is excluded from Git. Review it and run:

```bash
./start.sh test --strict
```

## What it checks

- DGX OS, ARM64 architecture, and NVIDIA GB10 GPU.
- Unified memory and expected storage capacity.
- Kernel, driver, and CUDA.
- Temperatures and recent NVIDIA Xid errors.
- NVMe identity and SMART health when available.
- Media errors, wear, hours of use, and unsafe shutdowns.
- A 512 MiB memory exercise.
- A temporary 256 MiB write and read in the user's home directory.
- A short CUDA computation using PyTorch or a native CUDA kernel.

The temporary file is deleted when it finishes. The test doesn't write directly to
block devices or modify the user's models or data.

## How to interpret the result

- **HEALTHY**: main checks passed.
- **ATTENTION**: the basic hardware responds, but you must review each warning.
- **HARDWARE CHECK FAILED**: don't accept the unit without diagnosing the failures.
- **AUTH FAILED** or **FAILED**: access, network, or preparation failed; this
  alone doesn't prove a hardware defect.

With `--strict`, any warning or skipped check produces an error. It is the
recommended option before buying.

Especially important signs:

- A GPU other than GB10 or memory well below 128 GB.
- An SSD smaller than the advertised capacity.
- `critical warning`, media errors, or high NVMe wear.
- Xid errors, abnormal temperatures, or CUDA failures.
- Failures in the memory or disk exercises.

Some checks may show up as `SKIP` if `nvme-cli`, SMART permissions, or PyTorch
are missing. Don't install anything on someone else's unit without the
seller's permission. If they allow it, `--prepare` installs diagnostic tools and
may download several GB:

```bash
./start.sh test nvidia@SPARK_IP --interactive --prepare --strict
```

## Keep evidence

You can save the output without color codes:

```bash
./start.sh test nvidia@SPARK_IP \
  --interactive \
  --expect-disk-tb 1 \
  --strict \
  --no-color | tee dgx-spark-test.txt
```

Review the report before paying. For a used unit, also ask for time for
a prolonged test and confirm the warranty separately.

## SECURITY NOTES

- Never type passwords in arguments, files, or variables.
- Verify the SSH fingerprint from the physical console.
- Use a trusted network and afterwards remove any temporary authorized key.
- The report may contain the hostname, IP, model, and NVMe data; don't
  publish it without reviewing it.
