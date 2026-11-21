import asyncio
import base64
import io
import json
import math
import sqlite3
import hashlib
import os
import struct
import subprocess
import tempfile
import time
import unittest
import zlib
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, mock_open, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

import backend.main as main_module
from backend.i18n import Catalog, request_language, translate_payload
from backend.gateway import (
    active_routes,
    app as gateway_app,
    litellm_adapter,
    supports_endpoint,
    supports_gateway_protocol,
)
from backend.main import (
    docker_storage_bytes,
    exclusive_directory_sizes,
    Database,
    ModelPayload,
    ProfilePayload,
    app,
    build_llama_args,
    collect_metrics,
    comfyui_workflow,
    context_attempts,
    db,
    decode_media_data_url,
    device_identity,
    hf_gguf_groups,
    hf_is_uncensored,
    hf_mmproj_files,
    hf_model_capabilities,
    hf_model_formats,
    hf_model_tasks,
    hf_spark_recommendation,
    huggingface_token,
    local_hf_models,
    local_hf_repo_details,
    nvidia_metrics,
    nvme_storage_devices,
    persistent_model_config,
    persist_model_metrics,
    profile_model_is_downloaded,
    profile_memory_plan,
    profile_models,
    seed_artifex_profiles,
    save_persistent_models,
    run_system_update,
    settings,
    software_versions,
    storage,
    storage_partitions,
    system_integrity,
    system_readiness,
)

settings.trusted_hosts = "testserver"

# Muchos tests del gateway no aíslan db.path; la marca de actividad no debe
# escribir en la base local del desarrollador.
_gateway_activity_patch = patch("backend.gateway.mark_gateway_inference")


def setUpModule() -> None:
    _gateway_activity_patch.start()


def tearDownModule() -> None:
    _gateway_activity_patch.stop()


class DatabaseTests(unittest.TestCase):
    def test_apt_updates_include_versions_security_and_categories(self) -> None:
        packages = main_module.parse_apt_upgradable(
            "Listing... Done\n"
            "linux-image-nvidia/noble-security 7.0.0 arm64 "
            "[upgradable from: 6.14.0]\n"
            "cuda-toolkit-13-0/noble 13.0.2 arm64 "
            "[upgradable from: 13.0.1]\n"
        )
        self.assertEqual(packages[0]["current_version"], "6.14.0")
        self.assertEqual(packages[0]["candidate_version"], "7.0.0")
        self.assertTrue(packages[0]["security"])
        self.assertEqual(packages[0]["category"], "kernel")
        self.assertEqual(packages[1]["category"], "nvidia")

    def test_profile_runtime_intent_survives_service_shutdown(self) -> None:
        original_path = db.path
        original_ids = list(main_module._runtime_profile_ids)
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "runtime-intent.db"
            db.initialize()
            try:
                main_module.save_desired_profile_ids(["profile-a", "profile-b"])
                main_module._runtime_profile_ids[:] = ["profile-a", "profile-b"]
                asyncio.run(main_module.stop_profile_process(preserve_desired=True))
                self.assertEqual(
                    main_module.desired_profile_ids(),
                    ["profile-a", "profile-b"],
                )

                main_module._runtime_profile_ids[:] = ["profile-a"]
                asyncio.run(main_module.stop_profile_process())
                self.assertEqual(main_module.desired_profile_ids(), [])
            finally:
                main_module._runtime_profile_ids[:] = original_ids
                db.path = original_path

    def test_startup_restores_every_desired_profile_in_order(self) -> None:
        profiles = {
            "profile-a": {"id": "profile-a", "name": "Perfil A"},
            "profile-b": {"id": "profile-b", "name": "Perfil B"},
        }

        def rows(_query: str, parameters: tuple[str]) -> list[dict[str, str]]:
            profile = profiles.get(parameters[0])
            return [profile] if profile else []

        with (
            patch(
                "backend.main.desired_profile_ids",
                return_value=["profile-a", "profile-b"],
            ),
            patch("backend.main.db.rows", side_effect=rows),
            patch("backend.main.db.audit"),
            patch(
                "backend.main.start_profile_process",
                new=AsyncMock(),
            ) as start,
            patch("backend.main.queue_profile_benchmarks") as benchmarks,
        ):
            asyncio.run(main_module.restore_desired_profiles(None))

        self.assertEqual(
            [call.args[0]["id"] for call in start.await_args_list],
            ["profile-a", "profile-b"],
        )
        self.assertTrue(all(
            call.kwargs == {"persist_desired": False}
            for call in start.await_args_list
        ))
        self.assertEqual(benchmarks.call_count, 2)

    def test_startup_retries_profiles_whose_services_are_not_ready_yet(self) -> None:
        profiles = {
            "whisper-profile": {"id": "whisper-profile", "name": "Whisper"},
            "broken": {"id": "broken", "name": "Roto"},
        }
        attempts: dict[str, int] = {}

        async def start(profile: dict[str, Any], **_: Any) -> dict[str, Any]:
            attempts[profile["id"]] = attempts.get(profile["id"], 0) + 1
            if profile["id"] == "broken":
                raise RuntimeError("GGUF corrupto")
            if attempts[profile["id"]] < 3:
                raise main_module.ExternalRuntimeUnavailable("Whisper aún arrancando")
            return {}

        with (
            patch("backend.main.desired_profile_ids", return_value=["whisper-profile", "broken"]),
            patch("backend.main.db.rows", side_effect=lambda _q, p: [profiles[p[0]]] if p[0] in profiles else []),
            patch("backend.main.db.audit") as audit,
            patch("backend.main.db.log"),
            patch("backend.main.start_profile_process", new=start),
            patch("backend.main.queue_profile_benchmarks"),
            patch.object(main_module, "PROFILE_RESTORE_RETRY_INTERVAL_SECONDS", 0),
        ):
            asyncio.run(main_module.restore_desired_profiles(None))
        self.assertEqual(attempts, {"whisper-profile": 3, "broken": 1})
        self.assertEqual(main_module._boot_restore["state"], "done")
        self.assertEqual(main_module._boot_restore["pending"], [])
        self.assertTrue(any("GGUF corrupto" in error for error in main_module._boot_restore["errors"]))
        self.assertIn(("profile.autostart", "Whisper", True), [call.args[:3] for call in audit.call_args_list])

    def test_watchdog_relaunches_crashed_llama_server_with_backoff_and_gives_up(self) -> None:
        profile = {"id": "p", "name": "Perfil"}
        model = {"id": "m", "name": "Cyber-Tiel", "engine": "llama.cpp", "context_size": 32768}
        dead = SimpleNamespace(returncode=139, pid=1)
        launches: list[int] = []
        outcomes = iter([None, RuntimeError("CUDA error"), RuntimeError("CUDA error"),
                         RuntimeError("CUDA error"), RuntimeError("CUDA error")])

        async def launch(_profile: Any, _model: Any, context: int, key: str) -> None:
            launches.append(context)
            outcome = next(outcomes)
            if outcome:
                raise outcome
            main_module._profile_processes[key] = SimpleNamespace(returncode=None, pid=2)

        async def stop(key: str) -> None:
            main_module._profile_processes.pop(key, None)

        tick = lambda now: asyncio.run(main_module.watchdog_tick(now))
        with (
            patch.dict(main_module._runtime_profile_models, {"p": {"m": "p:m"}}, clear=True),
            patch.dict(main_module._profile_processes, {"p:m": dead}, clear=True),
            patch.dict(main_module._runtime_effective_contexts, {"p:m": 16384}, clear=True),
            patch.dict(main_module._watchdog_state, {}, clear=True),
            patch("backend.main.runtime_key_owner", return_value=(profile, model)),
            patch("backend.main.startup_log_detail", return_value=("CUDA error: illegal address", False)),
            patch("backend.main.launch_profile_model", new=launch),
            patch("backend.main.stop_model_process", new=stop),
            patch("backend.main.record_model_run") as runs,
            patch("backend.main.db.log") as log,
            patch("backend.main.db.rows", return_value=[]),
        ):
            tick(1000)
            self.assertEqual(launches, [])
            self.assertEqual(log.call_args.args[2], "profile.model.crashed")
            tick(1005)
            self.assertEqual(launches, [])
            tick(1011)
            self.assertEqual(launches, [16384])
            self.assertFalse(main_module._watchdog_state["p:m"]["dead"])
            main_module._profile_processes["p:m"] = SimpleNamespace(returncode=1, pid=2)
            now = 2000.0
            for _ in range(40):
                tick(now)
                now += 400
            self.assertEqual(len(launches), 5)
            self.assertTrue(main_module._watchdog_state["p:m"]["gave_up"])
            self.assertEqual(runs.call_args.args[2], "failed")
            tick(now + 10_000)
            self.assertEqual(len(launches), 5)

    def test_watchdog_waits_while_benchmarks_or_profile_starts_run(self) -> None:
        with (
            patch.dict(main_module._runtime_profile_models, {"p": {"m": "p:m"}}, clear=True),
            patch.dict(main_module._profile_processes, {}, clear=True),
            patch("backend.main.db.rows", return_value=[{"id": "suite"}]),
            patch("backend.main.runtime_key_owner") as owner,
        ):
            asyncio.run(main_module.watchdog_tick(1.0))
        owner.assert_not_called()

    def test_memory_pressure_alerts_once_when_sustained(self) -> None:
        breakdown = {"available": 30 * 1024**3, "runtimes": [
            {"name": "Cyber-Tiel", "bytes": 33 * 1024**3},
            {"name": "BaronLLM", "bytes": 22 * 1024**3},
            {"name": "tiny", "bytes": 1024**2},
        ]}
        with tempfile.TemporaryDirectory() as directory:
            pressure_file = Path(directory) / "memory"

            def pressure(full: float) -> None:
                pressure_file.write_text(
                    f"some avg10={full + 1:.2f} avg60=0.00 avg300=0.00 total=1\n"
                    f"full avg10={full:.2f} avg60=0.00 avg300=0.00 total=1\n",
                    encoding="ascii",
                )

            tick = lambda now: asyncio.run(main_module.memory_pressure_tick(now))
            with (
                patch.object(main_module, "MEMORY_PRESSURE_FILE", pressure_file),
                patch.dict(main_module._memory_pressure_state, {"high": 0, "notified_at": float("-inf")}),
                patch("backend.main.safe_memory_breakdown", new=AsyncMock(return_value=breakdown)),
                patch("backend.main.notify_safely") as notified,
                patch("backend.main.db.log"),
            ):
                pressure(76.35)
                self.assertEqual([tick(0), tick(10), tick(20)], [False, False, True])
                kind, title, message = notified.call_args.args
                self.assertEqual((kind, title), ("memory.pressure", "Memoria saturada"))
                self.assertIn("76 %", message)
                self.assertIn("Cyber-Tiel 33 GB, BaronLLM 22 GB", message)
                self.assertNotIn("tiny", message)
                self.assertFalse(tick(30))
                pressure(5.0)
                self.assertFalse(tick(40))
                pressure(80.0)
                self.assertEqual([tick(50), tick(60), tick(70)], [False, False, False])
                self.assertEqual([tick(920), tick(930)], [True, False])
                self.assertEqual(notified.call_count, 2)
                pressure_file.unlink()
                self.assertIsNone(main_module.memory_pressure_full_avg10())
                self.assertFalse(tick(2000))

    def test_model_load_job_reports_progress_and_outcome(self) -> None:
        updates: list[tuple[str, str, float, str]] = []
        record = lambda job_id, status, progress, message: updates.append((job_id, status, progress, message))

        async def load(fail: bool) -> None:
            async with main_module.model_load_job("model.quick.start", "org/Model-GGUF", "Model-GGUF", 8192):
                await asyncio.sleep(0.05)
                if fail:
                    raise HTTPException(status_code=409, detail="no cabe")

        with (
            patch("backend.main.db.create_job", return_value="job-1") as created,
            patch("backend.main.db.update_job", side_effect=record),
            patch.object(main_module, "MODEL_LOAD_PROGRESS_INTERVAL_SECONDS", 0.01),
        ):
            asyncio.run(load(False))
            created.assert_called_once_with("model.quick.start", "org/Model-GGUF")
            running = [item for item in updates if item[1] == "running"]
            self.assertTrue(running)
            self.assertTrue(all(5 <= item[2] <= 95 and item[3] == "Cargando Model-GGUF en memoria" for item in running))
            self.assertEqual(updates[-1][1:3], ("completed", 100))
            updates.clear()
            with self.assertRaises(HTTPException):
                asyncio.run(load(True))
            self.assertEqual(updates[-1][1:], ("failed", 100, "No se pudo cargar Model-GGUF: no cabe"))

    def test_assistant_chat_caps_reply_length_and_flags_truncation(self) -> None:
        ollama = AsyncMock(return_value={"message": {"content": "bucle bucle"}, "done_reason": "length"})
        with patch("backend.main.ollama_payload", new=ollama):
            message, model = asyncio.run(main_module.call_assistant_model(
                "llama3.2:3b", [{"role": "user", "content": "hola"}], tools_enabled=False,
            ))
        self.assertEqual(model, "llama3.2:3b")
        self.assertTrue(message["truncated"])
        self.assertEqual(ollama.call_args.args[2]["options"]["num_predict"], main_module.CHAT_MAX_REPLY_TOKENS)
        provider = main_module.assistant_provider_messages([message], "ollama")
        self.assertNotIn("truncated", provider[0])

    def test_quick_models_count_toward_loaded_llm_limit(self) -> None:
        models = {
            main_module.DEFAULT_PROFILE_ID: [{"task": "chat"}, {"task": "chat"}],
            main_module.QUICK_PROFILE_ID: [{"task": "chat"}, {"task": "vision"}, {"task": "embeddings"}, {"task": "chat", "enabled": False}],
            "user": [{"task": "chat"}, {"task": "chat"}],
        }
        profile = lambda profile_id: {"id": profile_id}
        with patch("backend.main.profile_models", side_effect=lambda item: models[item["id"]]):
            self.assertEqual(main_module.loaded_llm_slots([profile(main_module.DEFAULT_PROFILE_ID)]), 0)
            self.assertEqual(main_module.loaded_llm_slots([profile("user")]), 1)
            self.assertEqual(main_module.loaded_llm_slots([profile(main_module.QUICK_PROFILE_ID)]), 2)
            self.assertEqual(main_module.loaded_llm_slots([profile(main_module.QUICK_PROFILE_ID), profile("user")]), 3)

    def test_orphaned_llama_servers_from_previous_backend_are_reaped(self) -> None:
        ours = SimpleNamespace(pid=11, info={"pid": 11, "ppid": 1, "cmdline": ["/usr/local/bin/llama-server"]},
                               terminate=lambda: None, wait=lambda _timeout: None, kill=lambda: None)
        foreign = SimpleNamespace(pid=12, info={"pid": 12, "ppid": 1, "cmdline": ["/opt/llama-server"]})
        other = SimpleNamespace(pid=13, info={"pid": 13, "ppid": 1, "cmdline": ["python3"]})
        links = {
            "/proc/11/fd/1": str(main_module.ROOT / "logs" / "profile-a-a:m.log"),
            "/proc/12/fd/1": "/home/u/llama.log",
        }
        with (
            patch("backend.main.psutil.process_iter", return_value=[ours, foreign, other]),
            patch("backend.main.os.readlink", side_effect=lambda path: links[path]),
        ):
            self.assertEqual(main_module.reap_orphaned_llama_servers(), [11])

    def test_llama_server_children_die_with_the_backend_on_linux(self) -> None:
        libc = SimpleNamespace(calls=[])
        libc.prctl = lambda *args: libc.calls.append(args)
        with patch.object(main_module.sys, "platform", "linux"), patch.object(main_module, "_LIBC", libc), (
            patch("backend.main.os.getppid", return_value=42)
        ):
            main_module._die_with_parent(42)()
        self.assertEqual(libc.calls, [(1, 15, 0, 0, 0)])
        with patch.object(main_module.sys, "platform", "darwin"):
            self.assertIsNone(main_module._die_with_parent(42))

    def test_spark_recommendations_next_page_analyses_new_candidates_only(self) -> None:
        popular = [SimpleNamespace(id=f"org/popular-{index}", tags=[]) for index in range(200)]
        trending = [SimpleNamespace(id=f"org/trend-{index}", tags=[], trending_score=1) for index in range(200)]

        def list_models(**options):
            source = popular if options.get("sort") == "downloads" else trending
            return source[:options["limit"]]

        analysed: list[str] = []

        def recommendation(info, *_args):
            analysed.append(info.id)
            return {"id": info.id, "recommendation_status": "Recomendado", "recommended_score": 50,
                    "downloads": 0, "uncensored": False, "tasks": ["chat"], "input_modalities": ["text"],
                    "formats": ["gguf"], "recommended_engines": ["llama.cpp"]}

        with (
            patch("backend.main.HfApi") as api,
            patch("backend.main.hf_spark_recommendation", side_effect=recommendation),
            TestClient(app) as client,
        ):
            api.return_value.list_models.side_effect = list_models
            api.return_value.model_info.side_effect = lambda repo, **_: SimpleNamespace(id=repo)
            first = client.get("/api/models/search", params={"limit": 12}).json()
            first_analysed = set(analysed)
            analysed.clear()
            second = client.get("/api/models/search", params={"limit": 12, "page": 1}).json()
        self.assertEqual(len(first), 12)
        self.assertEqual(len(second), 12)
        self.assertFalse(first_analysed & set(analysed))
        self.assertFalse({item["id"] for item in first} & {item["id"] for item in second})

    def test_huggingface_recommendations_hide_reap_by_id_or_filename(self) -> None:
        listed = [
            SimpleNamespace(id="org/normal-GGUF", tags=["gguf"]),
            SimpleNamespace(id="org/model-REAP192-GGUF", tags=["gguf"]),
            SimpleNamespace(id="org/generic-GGUF", tags=["gguf"]),
        ]

        def info(repo: str, **_kwargs):
            filename = "weights-REAP192-Q4.gguf" if repo == "org/generic-GGUF" else "weights-Q4_K_M.gguf"
            return SimpleNamespace(id=repo, tags=["gguf"], siblings=[SimpleNamespace(rfilename=filename)])

        def recommendation(model, *_args):
            return {
                "id": model.id, "recommendation_status": "Compatible", "recommended_score": 80,
                "downloads": 1, "uncensored": False, "tasks": ["chat"], "input_modalities": ["text"],
                "formats": ["gguf"], "recommended_engines": ["llama.cpp"],
            }

        with patch("backend.main.HfApi") as api, \
                patch("backend.main.hf_spark_recommendation", side_effect=recommendation), \
                patch.object(main_module.settings, "mydgx_dashboard_password", None), \
                patch.object(main_module.settings, "mydgx_api_key", None), \
                patch.object(main_module.settings, "host", "127.0.0.1"), \
                TestClient(app) as client:
            api.return_value.list_models.return_value = listed
            api.return_value.model_info.side_effect = info
            results = client.get("/api/models/search", params={"limit": 10}).json()
        self.assertEqual([item["id"] for item in results], ["org/normal-GGUF"])

    def test_nvcc_version_is_read_from_the_release_line_not_the_last_line(self) -> None:
        output = (
            "nvcc: NVIDIA (R) Cuda compiler driver\n"
            "Copyright (c) 2005-2025 NVIDIA Corporation\n"
            "Built on Wed_Aug_20_01:57:39_PM_PDT_2025\n"
            "Cuda compilation tools, release 13.0, V13.0.88\n"
            "Build cuda_13.0.r13.0/compiler.36424714_0\n"
        )
        self.assertEqual(
            main_module.nvcc_cuda_status(output),
            (True, "CUDA 13.0 · Build cuda_13.0.r13.0/compiler.36424714_0"),
        )
        self.assertTrue(main_module.nvcc_cuda_status("Build cuda_13.1.r13.1/compiler.1_0")[0])
        self.assertFalse(main_module.nvcc_cuda_status("Cuda compilation tools, release 12.8, V12.8.93")[0])
        self.assertEqual(main_module.nvcc_cuda_status(""), (False, "nvcc no detectado"))

    def test_gateway_publishes_full_model_name_next_to_alias(self) -> None:
        llama = {"engine": "llama.cpp", "name": "ARTIFEX · Cyber-Tiel", "model_ref": "bughunter-tiel",
                 "model_alias": "bughunter-tiel", "model_file": "/models/hf/Cyber-Tiel-Coder-35B-A3B-Q6_K.gguf",
                 "context_size": 131072, "_runtime_context_size": 262144}
        entry = main_module.gateway_published_model(llama)
        self.assertEqual(entry["alias"], "bughunter-tiel")
        self.assertEqual(entry["full_name"], "Cyber-Tiel-Coder-35B-A3B-Q6_K")
        self.assertEqual(entry["context_length"], 262144)
        ollama = {"engine": "ollama", "model_ref": "qwen3.6:35b-a3b-q8_0", "model_alias": "chat"}
        self.assertEqual(main_module.gateway_model_full_name(ollama), "qwen3.6:35b-a3b-q8_0")
        whisper = {"engine": "whisper", "model_ref": "turbo", "model_repo": "openai/whisper-large-v3-turbo"}
        self.assertEqual(main_module.gateway_model_full_name(whisper), "openai/whisper-large-v3-turbo")

    def test_parameter_counts_cover_named_moe_and_size_estimates(self) -> None:
        self.assertEqual(main_module.estimated_parameter_counts(["ggml-org/gpt-oss-120b-GGUF"], 63_000_000_000, "MXFP4"), (116.8, 5.1, False))
        self.assertEqual(main_module.estimated_parameter_counts(["Kimi-Linear-48B-A3B"], 40_000_000_000, "Q6_K_L"), (48.0, 3.0, False))
        total, active, estimated = main_module.estimated_parameter_counts(["BaronLLM-Offensive"], 6_560_000_000, "Q6_K")
        self.assertEqual((total, active, estimated), (8.0, None, True))
        self.assertEqual(main_module.quantization_bits_per_weight("UD-Q4_K_XL"), 4.85)
        self.assertEqual(main_module.estimated_parameter_counts(["mystery"], 0, "Q4_K_M"), (None, None, False))
        self.assertEqual(main_module.estimated_parameter_counts(["mystery"], 5_000_000_000, "weird"), (None, None, False))

    def test_benchmark_model_info_summarises_metadata_for_model_cards(self) -> None:
        self.assertEqual(main_module.model_parameter_counts("Cyber-Tiel-Coder-35B-A3B-GGUF"), (35.0, 3.0))
        self.assertEqual(main_module.model_parameter_counts("Qwen3-TTS-12Hz-1.7B-Base"), (1.7, None))
        self.assertEqual(main_module.model_parameter_counts("Kokoro-82M"), (0.082, None))
        self.assertEqual(main_module.model_parameter_counts("whisper-large-v3-turbo"), (None, None))
        card = (
            "---\nlicense: apache-2.0\n---\n# Título\n![badge](x.svg)\n\n"
            "Un modelo de código **potente** con [contexto largo](https://example.com) "
            "pensado para agentes y revisión de seguridad en repositorios grandes.\n"
        )
        metadata = {
            "huggingface": {
                "pipeline_tag": "text-generation", "downloads": 1200, "likes": 34,
                "tags": ["gguf", "region:us", "license:apache-2.0", "code"],
                "card_data": {"license": "apache-2.0", "language": ["en", "es"], "base_model": "Qwen/Qwen3.6-35B-A3B"},
            },
            "runtime": {"name": "ARTIFEX · Cyber-Tiel Q6", "task": "chat", "estimated_memory_mb": 40960,
                        "input_modalities": ["text"], "output_modalities": ["text"]},
        }
        run = {"source": "ollama", "source_id": "peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF",
               "filename": "x.gguf", "card_text": card}
        info = main_module.benchmark_model_info(run, metadata)
        self.assertEqual((info["author"], info["parameters_b"], info["active_parameters_b"]), ("peculiar-ragdoll", 35.0, 3.0))
        self.assertEqual(info["tags"], ["gguf", "code"])
        self.assertEqual(info["languages"], ["en", "es"])
        self.assertEqual(info["license"], "apache-2.0")
        self.assertTrue(info["summary"].startswith("Un modelo de código potente con contexto largo"))

    def test_memory_mode_is_reapplied_after_reboot_until_restored(self) -> None:
        stops: list[str] = []
        states = iter([["comfyui"], ["comfyui"], []])

        async def fake_set(service_id: str, action: str) -> None:
            stops.append(f"{action} {service_id}")

        with (
            patch("backend.main.shutil.which", return_value="/usr/bin/systemctl"),
            patch("backend.main.memory_mode_state", side_effect=lambda: {"stopped": next(states), "profiles": [], "since": None}),
            patch("backend.main.optional_service_active", return_value=True),
            patch("backend.main.set_optional_service", new=fake_set),
            patch("backend.main.db.log"),
            patch("backend.main.asyncio.sleep", new=AsyncMock()),
        ):
            asyncio.run(main_module.reapply_memory_mode())
        self.assertEqual(stops, ["stop comfyui", "stop comfyui"])

    def test_gateway_uses_local_assistant_when_no_chat_profile_is_loaded(self) -> None:
        original_enabled = settings.assistant_enabled
        original_model = settings.assistant_model
        settings.assistant_enabled = True
        settings.assistant_model = "llama3.2:3b"
        try:
            with (
                patch("backend.gateway.running_profiles", return_value=[]),
                patch("backend.gateway.active_profile", return_value=None),
                patch("backend.gateway.managed_comfyui_enabled", return_value=False),
            ):
                profile, routes = active_routes()
            self.assertEqual(profile["id"], "managed-assistant")
            self.assertEqual(routes["llama3.2:3b"]["engine"], "ollama")
            self.assertEqual(routes["llama3.2:3b"]["task"], "chat")
        finally:
            settings.assistant_enabled = original_enabled
            settings.assistant_model = original_model

    def test_model_metrics_are_persisted(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "metrics.db"
            db.initialize()
            persist_model_metrics([{
                "created_at": datetime.now(timezone.utc).isoformat(),
                "profile_id": "profile-1",
                "model_id": "primary",
                "model_name": "Test model",
                "engine": "llama.cpp",
                "pid": 123,
                "attribution": "process",
                "cpu_percent": 12.5,
                "ram_bytes": 1024,
                "unified_memory_bytes": 1024,
                "gpu_memory_bytes": 512,
                "gpu_utilization": 42.0,
            }])
            rows = db.rows("SELECT * FROM model_metric_samples")
            self.assertEqual(rows[0]["model_name"], "Test model")
            self.assertEqual(rows[0]["gpu_utilization"], 42.0)
        db.path = original_path

    def test_job_lifecycle_and_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(str(Path(directory) / "test.db"))
            database.initialize()
            job_id = database.create_job("test", "model")
            database.update_job(job_id, "completed", 100, "done")
            database.audit("test.action", "model", True)

            jobs = database.rows("SELECT * FROM jobs")
            job_events = database.rows(
                "SELECT status,message FROM job_events WHERE job_id=? ORDER BY id",
                (job_id,),
            )
            events = database.rows("SELECT * FROM audit_events")

            self.assertEqual(jobs[0]["status"], "completed")
            self.assertEqual(jobs[0]["progress"], 100)
            self.assertEqual(
                [(event["status"], event["message"]) for event in job_events],
                [("queued", "En cola"), ("completed", "done")],
            )
            self.assertEqual(events[0]["success"], 1)

    def test_general_logs_are_structured_and_redact_sensitive_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(str(Path(directory) / "logs.db"))
            database.initialize()
            database.log(
                "error",
                "download",
                "download.failed",
                "Bearer example-placeholder",
                entity_type="model",
                entity_id="org/model",
                detail={
                    "api_key": "example-placeholder",
                    "reason": "token=example-placeholder",
                },
            )
            row = database.rows("SELECT * FROM system_logs ORDER BY id DESC LIMIT 1")[0]
            detail = json.loads(row["detail_json"])
            self.assertEqual(row["level"], "error")
            self.assertNotIn("example-placeholder", row["message"])
            self.assertEqual(detail["api_key"], "***REDACTED***")
            self.assertNotIn("example-placeholder", detail["reason"])

    def test_cancellable_job_state_is_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(str(Path(directory) / "jobs.db"))
            database.initialize()
            job_id = database.create_job("ollama.pull", "demo")
            self.assertTrue(database.request_job_cancel(job_id))
            self.assertTrue(database.job_cancel_requested(job_id))
            self.assertEqual(database.rows("SELECT status FROM jobs")[0]["status"], "cancelling")

    def test_profiles_are_persisted_and_only_one_can_be_active(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(str(Path(directory) / "profiles.db"))
            database.initialize()
            now = "2026-11-11T00:00:00+00:00"
            values = (
                "one", "Perfil local", "llama.cpp", "org/model-GGUF", "/models/model.gguf",
                8080, 8192, -1, 8, 512, 0.7, 0.95, 1.1, 1, 1, now, now,
            )
            database.execute(
                """
                INSERT INTO profiles(
                    id,name,engine,model_ref,model_file,port,context_size,gpu_layers,threads,
                    batch_size,temperature,top_p,repeat_penalty,flash_attention,active,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                values,
            )
            profile = database.rows("SELECT * FROM profiles WHERE active=1")[0]
            self.assertEqual(profile["context_size"], 8192)
            self.assertEqual(profile["engine"], "llama.cpp")

    def test_configured_default_profile_is_activated_after_seeding(self) -> None:
        original_path = db.path
        original_profile = settings.default_profile_id
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "default-profile.db"
                db.initialize()
                main_module.seed_artifex_profiles()
                settings.default_profile_id = "artifex-tiel-q6"

                profile = main_module.apply_configured_default_profile()

                self.assertIsNotNone(profile)
                self.assertEqual(profile["id"], "artifex-tiel-q6")
                self.assertEqual(
                    db.rows("SELECT id FROM profiles WHERE active=1"),
                    [{"id": "artifex-tiel-q6"}],
                )
        finally:
            settings.default_profile_id = original_profile
            db.path = original_path

    def test_profile_payload_has_safe_typed_defaults(self) -> None:
        payload = ProfilePayload(
            name="Qwen local",
            engine="llama.cpp",
            model_ref="org/qwen-GGUF",
            model_file="/models/qwen.gguf",
        )
        self.assertEqual(payload.context_size, 8192)
        self.assertEqual(payload.gpu_layers, -1)
        self.assertEqual(payload.task, "chat")
        self.assertEqual(payload.input_modalities, ["text"])

    def test_multimodal_payload_and_media_validation(self) -> None:
        payload = ModelPayload(
            engine="whisper",
            model_ref="whisper-local",
            task="asr",
            input_modalities=["audio"],
            output_modalities=["text"],
            runtime_backend="external",
            endpoint_url="http://127.0.0.1:9000",
        )
        self.assertEqual(payload.task, "asr")
        mime, content = decode_media_data_url("data:audio/wav;base64,V0FWRQ==", 32)
        self.assertEqual(mime, "audio/wav")
        self.assertEqual(content, b"WAVE")

    def test_managed_comfyui_workflows_have_image_and_video_outputs(self) -> None:
        image = comfyui_workflow("image-generation", "un paisaje")
        video = comfyui_workflow(
            "video-generation",
            "una cámara en movimiento",
            seed=42,
            width=832,
            height=480,
            steps=30,
            frames=33,
        )
        self.assertEqual(image["6"]["inputs"]["text"], "un paisaje")
        self.assertEqual(image["9"]["class_type"], "SaveImage")
        self.assertEqual(video["6"]["inputs"]["text"], "una cámara en movimiento")
        self.assertEqual(video["3"]["inputs"]["seed"], 42)
        self.assertEqual(video["3"]["inputs"]["steps"], 30)
        self.assertEqual(video["40"]["inputs"]["width"], 832)
        self.assertEqual(video["40"]["inputs"]["height"], 480)
        self.assertEqual(video["40"]["inputs"]["length"], 33)
        self.assertEqual(video["37"]["inputs"]["unet_name"], "wan2.1_t2v_1.3B_bf16.safetensors")
        self.assertEqual(video["47"]["class_type"], "SaveWEBM")

    def test_managed_comfyui_ephemeral_output_is_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "source" / "output" / "benchmark" / "video.webm"
            output.parent.mkdir(parents=True)
            output.write_bytes(b"temporary-video")
            with patch("backend.main.managed_comfyui_root", return_value=root):
                main_module.delete_managed_comfyui_output({
                    "filename": "video.webm",
                    "subfolder": "benchmark",
                    "type": "output",
                })
        self.assertFalse(output.exists())

    def test_llama_vision_adds_mmproj_argument(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mmproj = Path(directory) / "mmproj.gguf"
            mmproj.write_bytes(b"projector")
            profile = {
                "model_ref": "vision", "model_alias": "vision", "port": 18082,
                "context_size": 8192, "gpu_layers": -1, "threads": 4, "parallel": 1,
                "batch_size": 256, "ubatch_size": 128, "temperature": 0.2, "top_p": 0.9,
                "top_k": 0, "min_p": 0, "repeat_penalty": 0, "presence_penalty": 0,
                "flash_attention": 1, "jinja": 1, "reasoning_off": 0,
                "reasoning_effort": "", "kv_unified_per_slot": 0,
                "cache_type_k": "", "cache_type_v": "", "mmproj_file": str(mmproj),
            }
            args = build_llama_args("/usr/bin/llama-server", Path("/models/vision.gguf"), profile)
            self.assertEqual(args[args.index("--mmproj") + 1], str(mmproj.resolve()))

    def test_legacy_profile_schema_is_migrated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            with sqlite3.connect(path) as connection:
                connection.execute(
                    "CREATE TABLE profiles(id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0)"
                )
            database = Database(str(path))
            database.initialize()
            columns = {row["name"] for row in database.rows("PRAGMA table_info(profiles)")}
            self.assertIn("model_repo", columns)
            self.assertIn("runtime_requirement", columns)
            self.assertIn("favorite", columns)

    def test_legacy_metric_schema_adds_extended_telemetry_columns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy-metrics.db"
            with sqlite3.connect(path) as connection:
                connection.execute(
                    "CREATE TABLE metric_samples(id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)"
                )
            database = Database(str(path))
            database.initialize()
            columns = {
                row["name"] for row in database.rows("PRAGMA table_info(metric_samples)")
            }
            self.assertTrue({
                "gpu_power_watts",
                "gpu_power_limit_watts",
                "disk_read_bytes",
                "disk_write_bytes",
            }.issubset(columns))

    def test_llama_arguments_match_advanced_profile_options(self) -> None:
        profile = {
            "model_ref": "bughunter-tiel", "model_alias": "bughunter-tiel", "port": 18081,
            "context_size": 262144, "gpu_layers": 99, "threads": 0, "parallel": 1,
            "batch_size": 512, "ubatch_size": 256, "temperature": 0.6, "top_p": 0.95,
            "top_k": 20, "min_p": 0, "repeat_penalty": 0, "presence_penalty": 0,
            "flash_attention": 1, "jinja": 1, "reasoning_off": 1,
            "reasoning_effort": "", "kv_unified_per_slot": 1,
            "cache_type_k": "q8_0", "cache_type_v": "q8_0",
        }
        args = build_llama_args("/usr/bin/llama-server", Path("/models/tiel.gguf"), profile)
        self.assertIn("--kv-unified-per-slot", args)
        self.assertIn("--cache-type-k", args)
        self.assertIn("--reasoning", args)
        self.assertNotIn("--repeat-penalty", args)

    def test_multi_model_plan_rejects_duplicate_ports_and_builds_context_fallbacks(self) -> None:
        profile = {
            "id": "group", "name": "Grupo", "engine": "llama.cpp", "model_ref": "primary",
            "model_file": "/missing/primary.gguf", "model_repo": "", "model_filename": "",
            "port": 18080, "context_size": 262144, "parallel": 1, "min_free_memory_mb": 40960,
            "memory_reserve_mb": 4096, "auto_fit_context": 1, "minimum_context_size": 8192,
            "additional_models_json": """[{
                "id":"second","name":"Segundo","engine":"llama.cpp","model_ref":"second",
                "model_file":"/missing/second.gguf","model_repo":"","model_filename":"",
                "model_files":[],"port":18080,"context_size":65536,"parallel":1,
                "min_free_memory_mb":20480,"enabled":true
            }]""",
        }
        models = profile_models(profile)
        plan = profile_memory_plan(profile)
        attempts = context_attempts(profile, models[0])
        self.assertEqual(len(models), 2)
        self.assertEqual(plan["duplicate_ports"], [18080])
        self.assertFalse(plan["fits"])
        self.assertEqual(attempts[0], 262144)
        self.assertEqual(attempts[-1], 8192)


class CollectorTests(unittest.TestCase):
    def test_engine_version_parser_ignores_runtime_warnings(self) -> None:
        llama_output = (
            "load_backend: loaded CUDA backend\n"
            "version: 8680 (15f786e65)\n"
            "built with GCC for Linux aarch64\n"
        )
        ollama_output = (
            "Warning: could not connect to a running Ollama instance\n"
            "Warning: client version is 0.20.3\n"
        )
        vllm_output = (
            "W1112 torch._opaque_base is deprecated\n"
            "W1112 register_opaque_type is deprecated\n"
            "0.33.0\n"
        )
        self.assertEqual(
            main_module.command_version("llama.cpp", llama_output),
            "8680 (15f786e65)",
        )
        self.assertEqual(
            main_module.command_version("ollama", ollama_output),
            "0.20.3",
        )
        self.assertEqual(main_module.command_version("vllm", vllm_output), "0.33.0")

    def test_chatbot_ollama_model_cannot_be_deleted(self) -> None:
        with (
            patch(
                "backend.main.resolved_assistant_reference",
                new=AsyncMock(return_value="qwen3:0.6b"),
            ),
            patch("backend.main.ollama_payload", new=AsyncMock()) as delete,
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(
                    main_module.delete_ollama_model(
                        "qwen3:0.6b",
                        confirm="qwen3:0.6b",
                    )
                )
        self.assertEqual(raised.exception.status_code, 409)
        delete.assert_not_awaited()

    def test_safetensors_chat_model_points_to_gguf_when_no_engine_can_run_it(self) -> None:
        info = SimpleNamespace(
            id="dphn/Example-Chat-24B-FP8",
            tags=["text-generation", "conversational"],
            pipeline_tag="text-generation",
            siblings=[SimpleNamespace(rfilename=f"model-0000{i}-of-00002.safetensors", size=12 * 1024**3) for i in (1, 2)],
            config={}, card_data=None, private=False, gated=False,
            downloads=10, likes=1, trending_score=0, last_modified=None,
        )
        with patch("backend.main.shutil.which", return_value=None):
            result = hf_spark_recommendation(info, memory_total_mb=128 * 1024, memory_available_mb=120 * 1024)
        self.assertFalse(result["fits"])
        self.assertEqual(result["recommendation_status"], "No recomendado")
        self.assertEqual(result["gguf_search"], "Example-Chat-24B-FP8 GGUF")
        self.assertTrue(result["warnings"][0].startswith("Sin GGUF"))
        image = SimpleNamespace(**{**vars(info), "id": "Comfy-Org/Example-Image", "tags": ["text-to-image"], "pipeline_tag": "text-to-image"})
        with patch("backend.main.shutil.which", return_value=None):
            self.assertEqual(hf_spark_recommendation(image, memory_total_mb=128 * 1024, memory_available_mb=120 * 1024)["gguf_search"], "")

    def test_stop_audit_records_which_client_sent_it(self) -> None:
        def request(agent: str) -> Any:
            return SimpleNamespace(headers={"user-agent": agent} if agent else {})
        self.assertEqual(main_module.request_origin(request("MyDGXTray")), "origen: bandeja macOS")
        self.assertEqual(main_module.request_origin(request("Mozilla/5.0 (Macintosh)")), "origen: navegador")
        self.assertEqual(main_module.request_origin(request("curl/8.7.1")), "origen: curl/8.7.1")
        self.assertEqual(main_module.request_origin(request("")), "origen: desconocido")

    def test_seed_skips_existing_profiles_and_conflicting_new_ones(self) -> None:
        original_path = db.path
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "seed.db"
                db.initialize()
                catalog = json.loads((main_module.ROOT / "config" / "default-profiles.json").read_text(encoding="utf-8"))
                ids = [item["id"] for item in catalog["profiles"]]
                with patch("backend.main.validate_profile", side_effect=HTTPException(status_code=400, detail="El puerto 8077 lo usa la app web ragkit")):
                    main_module.seed_default_profiles()
                self.assertEqual(db.rows("SELECT id FROM profiles WHERE id IN (%s)" % ",".join("?" * len(ids)), tuple(ids)), [])
                main_module.seed_default_profiles()
                seeded = {row["id"] for row in db.rows("SELECT id FROM profiles")}
                self.assertTrue(set(ids) <= seeded)
                with patch("backend.main.validate_profile", side_effect=AssertionError("existing profiles must not be revalidated")):
                    main_module.seed_default_profiles()
        finally:
            db.path = original_path

    def test_local_model_tasks_come_from_the_card_header(self) -> None:
        header = "\nlicense: mit\npipeline_tag: text-to-speech\nlibrary_name: chatterbox\ntags:\n- tts\n- 'voice-cloning'\n"
        pipeline, tags = main_module.hf_card_task_hints(header)
        self.assertEqual(pipeline, "text-to-speech")
        self.assertEqual(tags, ["chatterbox", "tts", "voice-cloning"])
        self.assertEqual(main_module.hf_model_tasks("ResembleAI/chatterbox", pipeline, tags), ["tts"])
        self.assertEqual(main_module.hf_model_tasks("sentence-transformers/all-MiniLM-L6-v2", "sentence-similarity", []), ["embedding"])
        self.assertEqual(main_module.hf_model_tasks("MicksHF/Qwen-Image-2.1-Anime-Fusal", None, []), ["image-generation"])
        self.assertNotIn("hub", main_module.huggingface_card_cache_dir().parts[-1:])

    def test_huggingface_spark_ranking_selects_fitting_quantization(self) -> None:
        info = SimpleNamespace(
            id="Qwen/Example-Coder-GGUF",
            tags=["gguf", "text-generation", "license:apache-2.0"],
            pipeline_tag="text-generation",
            siblings=[
                SimpleNamespace(rfilename="Example-Q8_0.gguf", size=60 * 1024**3),
                SimpleNamespace(rfilename="Example-Q4_K_M.gguf", size=20 * 1024**3),
            ],
            config={"max_position_embeddings": 65_536},
            card_data=SimpleNamespace(to_dict=lambda: {"license": "apache-2.0"}),
            private=False,
            gated=False,
            downloads=100_000,
            likes=500,
            trending_score=250,
            last_modified=datetime.now(),
        )
        result = hf_spark_recommendation(
            info,
            "code",
            "balanced",
            memory_total_mb=128 * 1024,
            memory_available_mb=120 * 1024,
        )
        self.assertEqual(result["recommended_quantization"], "Q4_K_M")
        self.assertTrue(result["fits"])
        self.assertIn(result["recommendation_status"], {"Ideal", "Compatible"})
        self.assertIn("code", result["tasks"])
        self.assertEqual(result["license"], "apache-2.0")
        self.assertTrue(result["trusted_publisher"])
        self.assertGreater(result["community_score"], 0)
        self.assertEqual(result["trending_score"], 250)
        self.assertGreater(result["community_signals"]["trending_points"], 0)
        self.assertLessEqual(result["estimated_memory_mb"], result["memory_budget_mb"])

    def test_huggingface_community_score_combines_popularity_and_trend(self) -> None:
        low = main_module.hf_community_score(100, 2, 0)
        popular = main_module.hf_community_score(1_000_000, 5_000, 0)
        trending = main_module.hf_community_score(1_000_000, 5_000, 1_000)
        self.assertGreater(popular["score"], low["score"])
        self.assertGreater(trending["score"], popular["score"])
        self.assertGreater(trending["trending_points"], 0)
        self.assertLessEqual(trending["score"], 100)

    def test_huggingface_spark_ranking_rejects_oversized_model(self) -> None:
        info = SimpleNamespace(
            id="org/Oversized-GGUF",
            tags=["gguf"],
            pipeline_tag="text-generation",
            siblings=[SimpleNamespace(rfilename="Oversized-Q8_0.gguf", size=130 * 1024**3)],
            config={},
            card_data={},
            private=False,
            gated=False,
            downloads=10,
            likes=0,
            last_modified=None,
        )
        result = hf_spark_recommendation(
            info,
            "chat",
            "any",
            memory_total_mb=128 * 1024,
            memory_available_mb=110 * 1024,
        )
        self.assertFalse(result["fits"])
        self.assertEqual(result["recommendation_status"], "No recomendado")
        self.assertTrue(result["warnings"])

    def test_huggingface_recommendation_separates_capacity_from_free_memory(self) -> None:
        info = SimpleNamespace(
            id="org/Compact-Coder-GGUF",
            tags=["gguf", "text-generation", "license:apache-2.0"],
            pipeline_tag="text-generation",
            siblings=[
                SimpleNamespace(rfilename="Compact-Q4_K_M.gguf", size=2 * 1024**3),
            ],
            config={"max_position_embeddings": 8192},
            card_data={"license": "apache-2.0"},
            private=False,
            gated=False,
            downloads=1000,
            likes=20,
            last_modified=datetime.now(),
        )
        result = hf_spark_recommendation(
            info,
            "code",
            "compact",
            memory_total_mb=18 * 1024,
            memory_available_mb=4800,
        )

        self.assertTrue(result["fits"])
        self.assertFalse(result["fits_now"])
        self.assertEqual(result["memory_budget_mb"], 14 * 1024)
        self.assertEqual(result["memory_available_budget_mb"], 704)
        self.assertTrue(any("liberar memoria" in item for item in result["warnings"]))

    def test_huggingface_spark_prefers_moe_and_speculative_decoding(self) -> None:
        common = {
            "tags": ["gguf", "text-generation", "mtp", "license:apache-2.0"],
            "pipeline_tag": "text-generation",
            "siblings": [SimpleNamespace(rfilename="model-Q4_K_M.gguf", size=20 * 1024**3)],
            "card_data": {"license": "apache-2.0"},
            "private": False,
            "gated": False,
            "downloads": 10_000,
            "likes": 100,
            "last_modified": datetime.now(),
        }
        moe = SimpleNamespace(
            id="Qwen/Qwen3.6-35B-A3B-GGUF",
            config={
                "max_position_embeddings": 32_768,
                "num_local_experts": 128,
                "num_experts_per_tok": 8,
            },
            **common,
        )
        dense = SimpleNamespace(
            id="Qwen/Qwen-Dense-35B-GGUF",
            config={"max_position_embeddings": 32_768},
            **common,
        )
        moe_result = hf_spark_recommendation(
            moe, "chat", "balanced",
            memory_total_mb=128 * 1024, memory_available_mb=120 * 1024,
        )
        dense_result = hf_spark_recommendation(
            dense, "chat", "balanced",
            memory_total_mb=128 * 1024, memory_available_mb=120 * 1024,
        )
        self.assertTrue(moe_result["is_moe"])
        self.assertEqual(moe_result["active_parameters_b"], 3.0)
        self.assertIn("MTP", moe_result["speculative_methods"])
        self.assertGreater(moe_result["speculative_memory_mb"], 0)
        self.assertGreater(moe_result["estimated_tokens_per_second"], dense_result["estimated_tokens_per_second"])
        self.assertGreater(moe_result["recommended_score"], dense_result["recommended_score"])
        self.assertEqual(moe_result["recommended_slots"], 8)

    def test_huggingface_spark_cluster_scales_memory_and_bandwidth(self) -> None:
        original_cluster_size = settings.spark_cluster_size
        try:
            settings.spark_cluster_size = 2
            info = SimpleNamespace(
                id="org/Linked-Spark-GGUF", tags=["gguf"], pipeline_tag="text-generation",
                siblings=[SimpleNamespace(rfilename="model-Q4_K_M.gguf", size=130 * 1024**3)],
                config={}, card_data={"license": "apache-2.0"}, private=False, gated=False,
                downloads=100, likes=2, last_modified=None,
            )
            result = hf_spark_recommendation(
                info, "chat", "any",
                memory_total_mb=128 * 1024, memory_available_mb=120 * 1024,
            )
            self.assertTrue(result["fits"])
            self.assertEqual(result["spark_count"], 2)
            self.assertEqual(result["memory_bandwidth_gbps"], 546)
            self.assertIn("tensor parallel", result["runtime_requirement"])
        finally:
            settings.spark_cluster_size = original_cluster_size

    def test_huggingface_task_and_shard_detection(self) -> None:
        self.assertEqual(hf_model_tasks("org/Vision-Coder-GGUF", None, []), ["chat", "code", "vision"])
        self.assertIn("asr", hf_model_tasks("openai/whisper-large-v3", "automatic-speech-recognition", []))
        self.assertIn("image-generation", hf_model_tasks("org/flux-model", "text-to-image", []))
        audio = hf_model_capabilities("org/audio-chat", "audio-text-to-text", [])
        self.assertEqual(audio["input_modalities"], ["audio", "text"])
        self.assertIn("audio-chat", audio["tasks"])
        self.assertTrue(hf_is_uncensored("org/Model-Abliterated-GGUF", []))
        self.assertTrue(hf_is_uncensored("org/model", ["no-refusal"]))
        self.assertFalse(hf_is_uncensored("org/Standard-Instruct-GGUF", ["text-generation"]))
        groups = hf_gguf_groups([
            SimpleNamespace(rfilename="model-Q4_K_M-00001-of-00002.gguf", size=10),
            SimpleNamespace(rfilename="model-Q4_K_M-00002-of-00002.gguf", size=11),
            SimpleNamespace(rfilename="mmproj-model-f16.gguf", size=3),
        ])
        self.assertEqual(groups[0]["size"], 21)
        self.assertTrue(groups[0]["complete"])
        shared_engram = hf_gguf_groups([
            *[
                SimpleNamespace(
                    rfilename=f"IQ2_XXS/DeepSeek-Coder-IQ2_XXS-0000{index}-of-00006.gguf",
                    size=10,
                )
                for index in range(1, 6)
            ],
            SimpleNamespace(rfilename="DeepSeek-Engram-IQ4_NL.gguf", size=50),
        ])
        self.assertEqual(len(shared_engram), 1)
        self.assertTrue(shared_engram[0]["complete"])
        self.assertEqual(shared_engram[0]["expected_shards"], 6)
        self.assertEqual(len(shared_engram[0]["files"]), 6)
        self.assertEqual(shared_engram[0]["size"], 100)
        self.assertEqual(shared_engram[0]["resident_size"], 50)
        self.assertTrue(shared_engram[0]["files"][0].endswith("-00001-of-00006.gguf"))
        self.assertIn("DeepSeek-Engram-IQ4_NL.gguf", shared_engram[0]["files"])
        main_groups = hf_gguf_groups([
            SimpleNamespace(rfilename="dspark-DeepSeek-V4.1-Flash-Q8_0.gguf", size=7),
            SimpleNamespace(rfilename="MTP/mtp-Qwen3.8-Flash-Next-Q4_K_M.gguf", size=2),
            SimpleNamespace(rfilename="UD-IQ3_XXS/Qwen3.8-Flash-Next-UD-IQ3_XXS-00001-of-00001.gguf", size=80),
        ])
        self.assertEqual([group["files"] for group in main_groups], [["UD-IQ3_XXS/Qwen3.8-Flash-Next-UD-IQ3_XXS-00001-of-00001.gguf"]])
        self.assertEqual(hf_mmproj_files([
            SimpleNamespace(rfilename="mmproj-model-f16.gguf", size=3),
        ])[0]["name"], "mmproj-model-f16.gguf")
        self.assertEqual(hf_model_formats([
            SimpleNamespace(rfilename="model.safetensors"),
            SimpleNamespace(rfilename="model.onnx"),
        ]), ["onnx", "safetensors"])

    def test_reap_detection_is_strict_and_download_validation_blocks_it(self) -> None:
        self.assertTrue(main_module.hf_requires_unsupported_reap_runtime("org/DeepSeek-REAP192-GGUF"))
        self.assertTrue(main_module.hf_requires_unsupported_reap_runtime("org/model", ["weights-REAP-192-Q4.gguf"]))
        self.assertFalse(main_module.hf_requires_unsupported_reap_runtime("org/Reaper-Instruct-GGUF"))
        self.assertTrue(main_module.hf_info_requires_unsupported_reap_runtime(SimpleNamespace(
            id="org/generic-deepseek",
            tags=["gguf"],
            siblings=[SimpleNamespace(rfilename="weights-REAP192-Q4.gguf")],
        )))
        info = SimpleNamespace(
            sha="abc",
            tags=["gguf"],
            siblings=[SimpleNamespace(rfilename="DeepSeek-REAP192-Q4.gguf", size=1024)],
        )
        api = SimpleNamespace(model_info=lambda *_args, **_kwargs: info)
        with patch.object(main_module, "HfApi", return_value=api), \
                self.assertRaises(main_module.ModelDownloadValidationError) as caught:
            asyncio.run(main_module.validate_hf_download(
                "org/DeepSeek-REAP192-GGUF", "main", ["DeepSeek-REAP192-Q4.gguf"],
            ))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("REAP", caught.exception.detail)

    def test_hf_failure_reason_explains_gated_repos_with_and_without_token(self) -> None:
        response = httpx.Response(401, request=httpx.Request("GET", "https://huggingface.co/org/model"))
        gated = main_module.GatedRepoError("gated", response=response)
        with patch.object(settings, "hf_token", ""):
            without_token = main_module.huggingface_failure_reason(gated, "org/model")
        with patch.object(settings, "hf_token", "test-only-token"):
            with_token = main_module.huggingface_failure_reason(gated, "org/model")
        self.assertIn("Sin HF_TOKEN", without_token or "")
        self.assertIn("no tiene acceso a org/model", with_token or "")
        self.assertIsNone(main_module.huggingface_failure_reason(ValueError("x"), "org/model"))

    def test_download_validation_reports_gated_access_before_queueing(self) -> None:
        info = SimpleNamespace(
            sha="abc",
            tags=["gguf"],
            gated="manual",
            siblings=[SimpleNamespace(rfilename="Model-Q4_K_M.gguf", size=1024)],
        )
        api = SimpleNamespace(model_info=lambda *_args, **_kwargs: info)
        response = httpx.Response(401, request=httpx.Request("HEAD", "https://huggingface.co/org/model"))
        denied = main_module.GatedRepoError("gated", response=response)
        with patch.object(main_module, "HfApi", return_value=api), \
                patch.object(main_module, "get_hf_file_metadata", side_effect=denied), \
                patch.object(settings, "hf_token", ""), \
                self.assertRaises(main_module.ModelDownloadValidationError) as caught:
            asyncio.run(main_module.validate_hf_download("org/model", "main", ["Model-Q4_K_M.gguf"]))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("Repositorio restringido", caught.exception.detail)

    def test_download_validation_rejects_drafter_without_main_model(self) -> None:
        drafter = "Mistral-Large-4-1T-A52B-DSpark-Q8_0.gguf"
        self.assertEqual(main_module.gguf_file_role(drafter, {}), "draft-dspark")
        self.assertEqual(main_module.gguf_file_role("OrcaCyber-Nano-1.0-AI-Defense-DFlash2-Q8_0.gguf", {}), "draft-dflash")
        orca = [
            SimpleNamespace(rfilename=name, size=size)
            for name, size in (
                ("OrcaCyber-Nano-1.0-AI-Defense-DFlash2-Q8_0.gguf", 2_100),
                ("OrcaCyber-Nano-1.0-AI-Defense-Mix-15.7G.gguf", 15_700),
                ("OrcaCyber-Nano-1.0-AI-Defense-Mix-13G.gguf", 13_000),
                ("mmproj-OrcaCyber-Nano-1.0-AI-Defense-F16.gguf", 900),
            )
        ]
        main_files = {name for group in main_module.hf_gguf_groups(orca) for name in group["files"]}
        self.assertNotIn("OrcaCyber-Nano-1.0-AI-Defense-DFlash2-Q8_0.gguf", main_files)
        self.assertIn("OrcaCyber-Nano-1.0-AI-Defense-Mix-15.7G.gguf", main_files)
        info = SimpleNamespace(
            sha="abc",
            tags=["gguf"],
            siblings=[
                SimpleNamespace(rfilename=drafter, size=1024),
                SimpleNamespace(rfilename="mmproj-Mistral-BF16.gguf", size=1024),
            ],
        )
        api = SimpleNamespace(model_info=lambda *_args, **_kwargs: info)
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(settings, "hf_home", directory), \
                patch.object(main_module, "HfApi", return_value=api), \
                self.assertRaises(main_module.ModelDownloadValidationError) as caught:
            asyncio.run(main_module.validate_hf_download(
                "org/Mistral-GGUF", "main", [drafter, "mmproj-Mistral-BF16.gguf"],
            ))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("falta el modelo principal", caught.exception.detail)

    def test_shared_engram_is_linked_as_missing_final_shard(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            split_dir = snapshot / "IQ2_XXS"
            split_dir.mkdir()
            downloaded: dict[str, Path] = {}
            for index in range(1, 6):
                name = f"IQ2_XXS/DeepSeek-Coder-IQ2_XXS-{index:05d}-of-00006.gguf"
                path = snapshot / name
                path.write_bytes(str(index).encode())
                downloaded[name] = path
            engram_name = "DeepSeek-Engram-IQ4_NL.gguf"
            engram = snapshot / engram_name
            engram.write_bytes(b"engram")
            downloaded[engram_name] = engram

            aliases = main_module.materialize_hf_shared_engram_aliases(downloaded)

            alias_name = "IQ2_XXS/DeepSeek-Coder-IQ2_XXS-00006-of-00006.gguf"
            alias = snapshot / alias_name
            self.assertEqual(aliases, [alias_name])
            self.assertTrue(alias.is_symlink())
            self.assertEqual(alias.resolve(), engram.resolve())

    def test_hft_uncensored_catalog_feeds_abliterated_search(self) -> None:
        page = """
        <ul>
          <li class="um-card" data-i="0" data-s="51.11" data-u="65.69" data-n="36.53" data-size="18.7"
              data-qs="{&quot;Q2_K&quot;:[11.9,1],&quot;Q4_K_M&quot;:[18.7,1]}"
              data-gguf="mradermacher/gemma-4-31B-it-heretic-GGUF" data-api="1"
              data-use="analysis code vision think" data-q="gemma heretic coder3101">
            <h2>gemma-4-31B-it-heretic</h2>
            <p class="um-by">by coder3101 · built on Gemma 4 31B</p>
            <span class="um-b">31B</span><span class="um-b">Vision</span>
            <dl class="um-scores"><div><dt>Answers</dt><dd><b>10/10</b></dd></div></dl>
            <p class="um-good"><b>For trading:</b> Reads charts.</p>
            <a href="https://huggingface.co/coder3101/gemma-4-31B-it-heretic">Hugging Face</a>
            <ol><li>nested item</li></ol>
          </li>
          <li class="um-card" data-s="47" data-u="59.5" data-n="35.3" data-size="42.5"
              data-qs="{&quot;Q4_K_M&quot;:[42.5,1]}"
              data-gguf="mradermacher/Assistant_Pepe_70B-GGUF"
              data-use="analysis code" data-q="assistant pepe llama">
            <h2>Assistant_Pepe_70B</h2>
            <p class="um-by">by SicariusSicariiStuff · built on Llama 3.1 70B</p>
            <a href="https://huggingface.co/SicariusSicariiStuff/Assistant_Pepe_70B">HF</a>
          </li>
          <li class="um-card" data-gguf="not-a-repo" data-q="ignored"></li>
        </ul>
        """
        models = main_module.parse_hft_uncensored_catalog(page)
        self.assertEqual([item["gguf_repo"] for item in models], [
            "mradermacher/gemma-4-31B-it-heretic-GGUF",
            "mradermacher/Assistant_Pepe_70B-GGUF",
        ])
        gemma = models[0]
        self.assertEqual(gemma["source_repo"], "coder3101/gemma-4-31B-it-heretic")
        self.assertEqual(gemma["author"], "coder3101")
        self.assertEqual(gemma["base_model"], "Gemma 4 31B")
        self.assertEqual(gemma["parameters"], "31B")
        self.assertEqual(gemma["answers"], "10/10")
        self.assertEqual(gemma["summary"], "Reads charts.")
        self.assertEqual(gemma["uncensored_iq"], 65.69)
        fitting = main_module.hft_catalog_for_search(models, "", "any", "any", 128 * 1024, "compact")
        self.assertEqual(
            [item["gguf_repo"] for item in fitting],
            ["mradermacher/gemma-4-31B-it-heretic-GGUF"],
        )
        self.assertEqual(
            main_module.hft_catalog_for_search(models, "", "any", "any", 8 * 1024),
            [],
        )
        broad = main_module.hft_catalog_for_search(models, "", "vision", "image", 128 * 1024)
        self.assertEqual(broad[0]["gguf_repo"], "mradermacher/gemma-4-31B-it-heretic-GGUF")
        queried = main_module.hft_catalog_for_search(models, "pepe", "code", "any", 16 * 1024)
        self.assertEqual(queried[0]["gguf_repo"], "mradermacher/Assistant_Pepe_70B-GGUF")
        result = {
            "tasks": ["chat"],
            "input_modalities": ["text"],
            "uncensored": False,
            "reasons": ["GGUF detectado"],
        }
        main_module.apply_hft_catalog_metadata(result, queried[0])
        self.assertTrue(result["uncensored"])
        self.assertIn("code", result["tasks"])
        self.assertEqual(result["hft_catalog"]["url"], "https://hft.md/uncensored-ai/")
        self.assertEqual(result["reasons"][0], "Incluido en el catálogo hft.md de modelos sin censura")

    def test_hft_catalog_loader_keeps_stale_cache_when_source_fails(self) -> None:
        original = dict(main_module._hft_catalog_cache)
        try:
            main_module._hft_catalog_cache["models"] = [{"gguf_repo": "org/cached"}]
            main_module._hft_catalog_cache["fetched_at"] = 0.0
            with patch("backend.main.httpx.Client") as client:
                client.return_value.__enter__.return_value.get.side_effect = httpx.ConnectError("down")
                loaded = main_module.load_hft_uncensored_catalog()
            self.assertEqual(loaded, [{"gguf_repo": "org/cached"}])
            self.assertEqual(main_module._hft_catalog_cache["models"], [{"gguf_repo": "org/cached"}])
        finally:
            main_module._hft_catalog_cache.clear()
            main_module._hft_catalog_cache.update(original)

    def test_huggingface_vision_bundles_mmproj_and_external_media_selects_engine(self) -> None:
        vision = SimpleNamespace(
            id="org/Vision-GGUF", tags=["image-text-to-text"], pipeline_tag="image-text-to-text",
            siblings=[
                SimpleNamespace(rfilename="vision-Q4_K_M.gguf", size=8 * 1024**3),
                SimpleNamespace(rfilename="mmproj-model-f16.gguf", size=800 * 1024**2),
            ],
            config={"max_position_embeddings": 8192}, card_data={"license": "apache-2.0"},
            private=False, gated=False, downloads=1000, likes=20, last_modified=None,
        )
        result = hf_spark_recommendation(
            vision, "vision", "any", "llama.cpp",
            memory_total_mb=128 * 1024, memory_available_mb=120 * 1024,
        )
        self.assertTrue(result["fits"])
        self.assertEqual(result["recommended_mmproj_file"], "mmproj-model-f16.gguf")
        self.assertIn("mmproj-model-f16.gguf", result["recommended_files"])
        image = SimpleNamespace(
            id="org/Image-Generator", tags=["text-to-image"], pipeline_tag="text-to-image",
            siblings=[SimpleNamespace(rfilename="model.safetensors", size=12 * 1024**3)],
            config={}, card_data={"license": "apache-2.0"}, private=False, gated=False,
            downloads=1000, likes=20, last_modified=None,
        )
        media = hf_spark_recommendation(
            image, "image-generation", "any", "external",
            memory_total_mb=128 * 1024, memory_available_mb=120 * 1024,
        )
        self.assertTrue(media["fits"])
        self.assertIn("ComfyUI", media["recommended_engines"])
        self.assertEqual(media["output_modalities"], ["image"])

    def test_empty_huggingface_token_is_not_sent(self) -> None:
        original = settings.hf_token
        settings.hf_token = "   "
        self.assertIsNone(huggingface_token())
        settings.hf_token = original

    def test_nvidia_metrics_keeps_supported_gb10_values(self) -> None:
        result = type("Result", (), {
            "returncode": 0,
            "stdout": "0, [N/A], [N/A], 41, 42.5, 120\n",
        })()
        with patch("backend.main.shutil.which", return_value="/usr/bin/nvidia-smi"), patch(
            "backend.main.run_command", return_value=result
        ):
            metrics = nvidia_metrics()
        self.assertEqual(metrics["gpu_utilization"], 0.0)
        self.assertEqual(metrics["gpu_temperature"], 41.0)
        self.assertEqual(metrics["gpu_power_watts"], 42.5)
        self.assertEqual(metrics["gpu_power_limit_watts"], 120.0)
        self.assertIsNone(metrics["gpu_memory_used"])
        self.assertIsNone(metrics["gpu_memory_total"])

    def test_collect_metrics_has_expected_ranges(self) -> None:
        sample = collect_metrics()
        self.assertGreater(sample["memory_total"], 0)
        self.assertGreater(sample["disk_total"], 0)
        self.assertGreaterEqual(sample["cpu_percent"], 0)
        self.assertLessEqual(sample["cpu_percent"], 100)

    def test_huggingface_cache_inventory(self) -> None:
        original = settings.hf_home
        with tempfile.TemporaryDirectory() as directory:
            settings.hf_home = directory
            root = Path(directory) / "hub" / "models--org--demo"
            blobs = root / "blobs"
            snapshot = root / "snapshots" / "abc"
            refs = root / "refs"
            blobs.mkdir(parents=True)
            snapshot.mkdir(parents=True)
            refs.mkdir()
            (refs / "main").write_text("abc")
            weights = blobs / "weights"
            weights.write_bytes(b"model")
            config = blobs / "config"
            config.write_text('{"model_type":"demo","max_position_embeddings":4096}')
            (snapshot / "model-Q4_K_M.gguf").symlink_to(weights)
            (snapshot / "config.json").symlink_to(config)

            inventory = local_hf_models()

            self.assertEqual(inventory[0]["repo_id"], "org/demo")
            self.assertIn("GGUF", inventory[0]["formats"])
            self.assertEqual(inventory[0]["quantizations"], ["Q4_K_M"])
            self.assertEqual(inventory[0]["configuration"]["model_type"], "demo")
            self.assertEqual(inventory[0]["configuration"]["max_position_embeddings"], 4096)
            self.assertEqual(inventory[0]["revision"], "abc")
        settings.hf_home = original

    def test_huggingface_details_detect_incomplete_shards_and_partial_blobs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / "snapshots" / "abc"
            blobs = root / "blobs"
            refs = root / "refs"
            snapshot.mkdir(parents=True)
            blobs.mkdir()
            refs.mkdir()
            (refs / "main").write_text("abc")
            blob = blobs / "weight"
            blob.write_bytes(b"data")
            (blobs / "pending.incomplete").write_bytes(b"x")
            (snapshot / "model-Q4_K_M-00001-of-00002.gguf").symlink_to(blob)
            details = local_hf_repo_details(root)
            self.assertEqual(details["refs"]["main"], "abc")
            self.assertEqual(details["partials"][0]["name"], "pending.incomplete")
            self.assertFalse(details["shards"][0]["complete"])
            self.assertEqual(details["shards"][0]["missing"], [2])

    def test_profile_detects_huggingface_cached_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.gguf"
            model.write_bytes(b"gguf")
            with patch("backend.main.hf_hub_download", return_value=str(model)):
                self.assertTrue(profile_model_is_downloaded({
                    "engine": "llama.cpp",
                    "model_file": "",
                    "model_repo": "org/model-GGUF",
                    "model_filename": "model.gguf",
                }))

    def test_benchmark_local_artifact_combines_split_gguf_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "snapshots" / "commit-123"
            blobs = Path(directory) / "blobs"
            snapshot.mkdir(parents=True)
            blobs.mkdir()
            names = [
                "model-00001-of-00002.gguf",
                "model-00002-of-00002.gguf",
            ]
            digests = ["a" * 64, "b" * 64]
            paths = {}
            for name, digest, payload in zip(names, digests, (b"first", b"second")):
                blob = blobs / digest
                blob.write_bytes(payload)
                link = snapshot / name
                link.symlink_to(blob)
                paths[name] = str(link)

            with patch(
                "backend.main.hf_hub_download",
                side_effect=lambda **kwargs: paths[kwargs["filename"]],
            ):
                artifact = main_module.benchmark_hf_local_artifact({
                    "model_repo": "org/model-GGUF",
                    "model_files": names,
                })

            expected_files = [
                {"filename": names[0], "size": 5, "digest": digests[0]},
                {"filename": names[1], "size": 6, "digest": digests[1]},
            ]
            self.assertEqual(artifact["revision"], "commit-123")
            self.assertEqual(artifact["size"], 11)
            self.assertEqual(artifact["files"], expected_files)
            self.assertEqual(artifact["digest"], main_module.content_hash(expected_files))

    def test_software_inventory_contains_core_components(self) -> None:
        inventory = software_versions()
        names = {component["name"] for component in inventory["components"]}
        self.assertIn("Python", names)
        self.assertIn("CUDA Toolkit", names)
        self.assertIn("llama.cpp", names)
        self.assertIn("PyTorch", names)

    def test_system_readiness_has_core_checks_without_secrets(self) -> None:
        original_hf_token, original_gateway_key = settings.hf_token, settings.gateway_api_key
        settings.hf_token = "hf_test_secret_not_for_output"
        settings.gateway_api_key = "gateway_test_secret_not_for_output"
        try:
            with (
                patch("backend.main.device_identity", return_value={
                    "is_dgx_spark": False,
                    "device_model": "Development host",
                }),
                patch("backend.main.service_probe", new=AsyncMock(return_value=False)),
                patch("backend.main.gateway_runtime_config", return_value={
                    "enabled": False,
                    "host": "127.0.0.1",
                    "port": 4000,
                }),
                patch.object(db, "rows", return_value=[]),
            ):
                result = asyncio.run(system_readiness())
        finally:
            settings.hf_token, settings.gateway_api_key = original_hf_token, original_gateway_key
        check_ids = {check["id"] for check in result["checks"]}
        self.assertTrue({"python", "sqlite", "frontend", "disk-space", "api-auth"}.issubset(check_ids))
        encoded = json.dumps(result).lower()
        self.assertNotIn("hf_test_secret_not_for_output", encoded)
        self.assertNotIn("gateway_test_secret_not_for_output", encoded)

    def test_system_readiness_warns_for_unprotected_network_binding(self) -> None:
        original_host, original_key = settings.host, settings.mydgx_api_key
        settings.host, settings.mydgx_api_key = "0.0.0.0", None
        try:
            with (
                patch("backend.main.device_identity", return_value={
                    "is_dgx_spark": False,
                    "device_model": "Development host",
                }),
                patch("backend.main.service_probe", new=AsyncMock(return_value=False)),
                patch("backend.main.gateway_runtime_config", return_value={
                    "enabled": False,
                    "host": "127.0.0.1",
                    "port": 4000,
                }),
                patch.object(db, "rows", return_value=[]),
            ):
                result = asyncio.run(system_readiness())
        finally:
            settings.host, settings.mydgx_api_key = original_host, original_key
        api_check = next(check for check in result["checks"] if check["id"] == "api-auth")
        self.assertEqual(api_check["status"], "warning")

    def test_system_integrity_exposes_kernel_and_runtime_state(self) -> None:
        result = system_integrity()
        self.assertIn("current_kernel", result)
        self.assertIn("reboot_required", result)
        self.assertIn("llama_ok", result)
        self.assertIn("service_enabled", result)

    def test_system_update_runs_repair_and_persists_integrity(self) -> None:
        original_path = db.path
        commands: list[list[str]] = []
        integrity = {
            "healthy": True,
            "reboot_required": False,
            "current_kernel": "test",
        }
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "updates.db"
                db.initialize()
                job_id = db.create_job("system.update", "apt")

                def run(command: list[str], _: int = 30) -> SimpleNamespace:
                    commands.append(command)
                    return SimpleNamespace(returncode=0, stdout="", stderr="")

                with (
                    patch("backend.main.run_command", side_effect=run),
                    patch("backend.main.system_integrity", return_value=integrity),
                    patch(
                        "backend.main.SYSTEM_REPAIR_SCRIPT",
                        Path(__file__).resolve().parents[1] / "scripts" / "system-repair.sh",
                    ),
                ):
                    asyncio.run(run_system_update(job_id))
                job = db.rows("SELECT * FROM jobs WHERE id=?", (job_id,))[0]
                result = db.rows("SELECT * FROM job_results WHERE job_id=?", (job_id,))[0]
        finally:
            db.path = original_path

        self.assertEqual(job["status"], "completed")
        self.assertEqual(json.loads(result["result_json"]), integrity)
        self.assertTrue(any("--with-new-pkgs" in command for command in commands))
        self.assertTrue(any(command[-1] == "--repair" for command in commands))

    def test_inactive_profile_templates_do_not_make_system_unready(self) -> None:
        model = {
            "enabled": True,
            "engine": "llama.cpp",
            "name": "Plantilla grande",
            "model_ref": "org/template-GGUF",
            "port": 8080,
        }
        with (
            patch("backend.main.device_identity", return_value={
                "is_dgx_spark": False,
                "device_model": "Development host",
            }),
            patch("backend.main.service_probe", new=AsyncMock(return_value=False)),
            patch("backend.main.gateway_runtime_config", return_value={
                "enabled": False,
                "host": "127.0.0.1",
                "port": 4000,
            }),
            patch.object(db, "rows", return_value=[{"name": "Plantilla", "active": 0}]),
            patch("backend.main.profile_models", return_value=[model]),
            patch("backend.main.llama_binary", return_value="/usr/local/bin/llama-server"),
        ):
            result = asyncio.run(system_readiness())
        checks = {check["id"]: check for check in result["checks"]}
        self.assertEqual(checks["active-profile"]["status"], "info")
        self.assertNotIn("profile-capacity", checks)
        self.assertNotIn("profile-files", checks)

    def test_storage_ignores_file_bind_mounts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            volume = root / "workspace"
            volume.mkdir()
            bind_file = root / "nvidia-smi"
            bind_file.touch()
            partition = lambda mountpoint: type("Partition", (), {
                "device": "/dev/test",
                "mountpoint": str(mountpoint),
                "fstype": "ext4",
            })()
            usage = type("Usage", (), {
                "total": 100,
                "used": 25,
                "free": 75,
                "percent": 25.0,
            })()
            with patch(
                "backend.main.psutil.disk_partitions",
                return_value=[partition(bind_file), partition(volume)],
            ), patch(
                "backend.main.psutil.disk_usage",
                return_value=usage,
            ), patch(
                "backend.main.exclusive_directory_sizes",
                side_effect=lambda paths, device=None: [0] * len(paths),
            ), patch(
                "backend.main.docker_storage_bytes", return_value=0,
            ), patch(
                "backend.main.ollama_storage_bytes", new=AsyncMock(return_value=0),
            ), patch.dict(
                main_module._storage_usage_cache, {"value": None, "computed_at": 0.0, "task": None},
            ):
                result = asyncio.run(storage())
        self.assertEqual(
            {item["mountpoint"] for item in result["partitions"]},
            {"/", str(volume)},
        )
        self.assertEqual(result["categorized_total"], 25)
        self.assertFalse(result["usage_pending"])
        self.assertEqual(
            sum(item["size"] for item in result["usage_categories"]),
            result["categorized_total"],
        )

    def test_storage_partitions_hide_snap_squashfs_images(self) -> None:
        partition = namedtuple("partition", "device mountpoint fstype")
        mounts = [
            partition("/dev/nvme0n1p2", "/", "ext4"),
            partition("/dev/nvme0n1p1", "/boot/efi", "vfat"),
            partition("/dev/loop3", "/snap/firefox/9056", "squashfs"),
            partition("/dev/loop9", "/media/install", "iso9660"),
        ]
        usage = namedtuple("usage", "total used free percent")(100, 40, 60, 40.0)
        with patch("backend.main.psutil.disk_partitions", return_value=mounts), \
                patch("backend.main.psutil.disk_usage", return_value=usage), \
                patch("backend.main.Path.is_dir", return_value=True):
            mountpoints = [item["mountpoint"] for item in storage_partitions()]

        self.assertEqual(mountpoints, ["/", "/boot/efi"])

    def test_storage_answers_with_partitions_while_usage_is_still_computing(self) -> None:
        def slow_usage(ollama_bytes: int, docker_bytes: int) -> dict[str, Any]:
            time.sleep(0.3)
            return {"usage_categories": [{"id": "models", "label": "Modelos", "size": 7, "description": ""}],
                    "categorized_total": 7, "disk_total": 10, "disk_free": 3, "model_storage": []}

        async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
            first = await storage()
            await asyncio.sleep(0.5)
            return first, await storage()

        with patch("backend.main.storage_partitions", return_value=[{"mountpoint": "/"}]), \
                patch("backend.main.nvme_storage_devices", return_value=[]), \
                patch("backend.main.storage_usage", side_effect=slow_usage), \
                patch("backend.main.docker_storage_bytes", return_value=0), \
                patch("backend.main.ollama_storage_bytes", new=AsyncMock(return_value=0)), \
                patch("backend.main.STORAGE_USAGE_FIRST_WAIT_SECONDS", 0.05), \
                patch.dict(main_module._storage_usage_cache, {"value": None, "computed_at": 0.0, "task": None}):
            first, second = asyncio.run(scenario())
        self.assertEqual(first["partitions"], [{"mountpoint": "/"}])
        self.assertTrue(first["usage_pending"])
        self.assertEqual(first["usage_categories"], [])
        self.assertIsNone(first["usage_updated_at"])
        self.assertFalse(second["usage_pending"])
        self.assertEqual(second["categorized_total"], 7)
        self.assertIsNotNone(second["usage_updated_at"])

    def test_storage_lists_each_home_directory_outside_the_classified_groups(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            for name in ("ragkit", ".cache/huggingface", "Downloads", "tiny", "MyDGX-Dashboard", "opt",
                         ".local/share/mydgx"):
                (home / name).mkdir(parents=True)
            (home / "link").symlink_to(home / "ragkit")
            reported = {"ragkit": 400_000_000, ".cache": 70_000_000, "Downloads": 10_000_000}

            def sizes(paths, device=None):
                return [5_000_000 if path == home else reported.get(path.name, 0) for path in paths]

            usage = namedtuple("usage", "total used free percent")(2_000_000_000, 1_000_000_000, 1_000_000_000, 50.0)
            with patch("backend.main.Path.home", return_value=home), \
                    patch.object(main_module.settings, "hf_home", str(home / ".cache" / "huggingface")), \
                    patch("backend.main.STORAGE_APPS_ROOT", home / ".local" / "share" / "mydgx"), \
                    patch("backend.main.ROOT", home / "MyDGX-Dashboard"), \
                    patch("backend.main.psutil.disk_usage", return_value=usage), \
                    patch("backend.main.exclusive_directory_sizes", side_effect=sizes):
                result = main_module.storage_usage(0, 0)

        listed = [(item["name"], item["size"]) for item in result["home_directories"]]
        self.assertEqual(listed, [("ragkit", 400_000_000), (".cache", 70_000_000), ("Otros", 15_000_000)])
        self.assertIn("3 directorios pequeños", result["home_directories"][-1]["path"])
        home_group = next(item for item in result["usage_categories"] if item["id"] == "home")
        self.assertEqual(home_group["size"], sum(size for _, size in listed))

    def test_exclusive_directory_sizes_count_nested_directories_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "parent"
            child = parent / "child"
            child.mkdir(parents=True)
            (child / "big.bin").write_bytes(b"\0" * 3_000_000)
            (parent / "small.bin").write_bytes(b"\0" * 1_000_000)
            missing = Path(directory) / "missing"
            detected = main_module.du_skips_counted_directories()
            for gnu in {detected, False}:
                with self.subTest(gnu_du=gnu), patch("backend.main.du_skips_counted_directories", return_value=gnu):
                    sizes = exclusive_directory_sizes([child, missing, parent])
                    self.assertGreater(sizes[0], 2_800_000)
                    self.assertEqual(sizes[1], 0)
                    self.assertGreater(sizes[2], 900_000)
                    self.assertLess(sizes[2], 1_500_000)

    def test_docker_storage_adds_images_volumes_and_build_cache(self) -> None:
        output = "\n".join(json.dumps({"Type": kind, "Size": size}) for kind, size in (
            ("Images", "54.93GB"), ("Containers", "664.2kB"), ("Local Volumes", "1.78GB"), ("Build Cache", "13.78GB"),
        ))
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout=output, stderr="")
        with patch("backend.main.shutil.which", return_value="/usr/bin/docker"), \
                patch("backend.main.subprocess.run", return_value=completed):
            self.assertEqual(docker_storage_bytes(), 54_930_000_000 + 664_200 + 1_780_000_000 + 13_780_000_000)

    def test_nvme_inventory_uses_sysfs_without_privileged_device_access(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = root / "nvme" / "nvme0"
            block = root / "block" / "nvme0n1"
            temperature = controller / "hwmon1"
            temperature.mkdir(parents=True)
            block.mkdir(parents=True)
            (controller / "model").write_text("Test NVMe\n")
            (controller / "firmware_rev").write_text("1.2.3\n")
            (controller / "state").write_text("live\n")
            (temperature / "temp1_input").write_text("40850\n")
            (block / "size").write_text("2000\n")

            devices = nvme_storage_devices(root / "nvme", root / "block", root / "dev")

        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["model"], "Test NVMe")
        self.assertEqual(devices[0]["capacity"], 1_024_000)
        self.assertEqual(devices[0]["temperature"], 40.9)
        self.assertFalse(devices[0]["smart"]["available"])

    def test_device_variant_override(self) -> None:
        original = settings.device_variant_override
        settings.device_variant_override = "asus"
        device_identity.cache_clear()
        identity = device_identity()
        self.assertTrue(identity["is_dgx_spark"])
        self.assertEqual(identity["device_variant"], "asus")
        self.assertEqual(identity["device_model"], "ASUS Ascent GX10")
        settings.device_variant_override = "dell"
        device_identity.cache_clear()
        identity = device_identity()
        self.assertTrue(identity["is_dgx_spark"])
        self.assertEqual(identity["device_variant"], "dell")
        self.assertEqual(identity["device_model"], "Dell Pro Max GB10")
        settings.device_variant_override = original
        device_identity.cache_clear()

    def test_device_identity_detects_dell_pro_max_gb10(self) -> None:
        dmi = {
            "sys_vendor": "Dell Inc.",
            "product_name": "Dell Pro Max with GB10 FCM1253",
        }
        original = settings.device_variant_override
        settings.device_variant_override = ""
        device_identity.cache_clear()
        try:
            with patch.object(Path, "is_file", lambda self: self.name in dmi), \
                    patch.object(Path, "read_text", lambda self, **_: dmi[self.name]), \
                    patch.object(main_module.shutil, "which", return_value=None):
                identity = device_identity()
        finally:
            settings.device_variant_override = original
            device_identity.cache_clear()
        self.assertTrue(identity["is_dgx_spark"])
        self.assertEqual(identity["device_variant"], "dell")
        self.assertEqual(identity["device_vendor"], "Dell")
        self.assertEqual(identity["device_model"], "Dell Pro Max GB10")


QWEN35_MOE_SHAPE = {
    "block_count": 40, "embedding_length": 2048, "attention.head_count": 16, "attention.head_count_kv": 2,
    "attention.key_length": 256, "attention.value_length": 256, "full_attention_interval": 4,
    "ssm.conv_kernel": 4, "ssm.state_size": 128, "ssm.group_count": 16, "ssm.inner_size": 4096,
}


def write_test_gguf(
    path: Path, context_length: int, architecture: str = "qwen35moe", extra: "dict[str, Any] | None" = None,
) -> None:
    def text(value: str) -> bytes:
        data = value.encode("utf-8")
        return struct.pack("<Q", len(data)) + data

    def entry(key: str, value: Any) -> bytes:
        if isinstance(value, float):
            return text(key) + struct.pack("<If", 6, value)
        if isinstance(value, list):
            return text(key) + struct.pack("<IIQ", 9, 4, len(value)) + struct.pack(f"<{len(value)}I", *value)
        return text(key) + struct.pack("<II", 4, value)

    tokens = [f"token-{index}" for index in range(2000)]
    entries = [
        text("general.architecture") + struct.pack("<I", 8) + text(architecture),
        text("tokenizer.ggml.tokens") + struct.pack("<IIQ", 9, 8, len(tokens)) + b"".join(text(t) for t in tokens),
        text("tokenizer.ggml.scores") + struct.pack("<IIQ", 9, 6, 3) + struct.pack("<fff", 0.1, 0.2, 0.3),
        entry(f"{architecture}.context_length", context_length),
        *(entry(key if key.startswith("general.") else f"{architecture}.{key}", value) for key, value in (extra or {}).items()),
    ]
    path.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, len(entries)) + b"".join(entries))


class ModelImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.original_db = db.path
        self.original_hf_home = main_module.settings.hf_home
        db.path = self.root / "import.db"
        db.initialize()
        main_module.settings.hf_home = str(self.root / "hf")
        self.arch = patch("backend.main.llama_knows_architecture", return_value=True)
        self.arch.start()

    def tearDown(self) -> None:
        self.arch.stop()
        main_module.settings.hf_home = self.original_hf_home
        db.path = self.original_db
        self.directory.cleanup()

    def make_zip(self, entries: dict[str, bytes], name: str = "Mi Modelo.zip") -> Path:
        import zipfile

        path = self.root / name
        with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
            for member, data in entries.items():
                archive.writestr(member, data)
        return path

    def gguf(self, context: int = 32_768, architecture: str = "llama") -> bytes:
        path = self.root / f"tmp-{context}-{architecture}.gguf"
        write_test_gguf(path, context, architecture, extra={"block_count": 4})
        return path.read_bytes()

    def run_import(self, zip_path: Path) -> dict[str, Any]:
        job_id = db.create_job("models.import", zip_path.name)
        return main_module.extract_model_import(job_id, zip_path, zip_path.name)

    def test_folder_zip_becomes_a_cached_model_with_manifest_settings(self) -> None:
        manifest = {
            "name": "Mi Modelo Ñandú", "description": "Un modelo de prueba", "license": "apache-2.0",
            "tags": ["español"], "settings": {"context_size": 16384, "temperature": 0.4},
        }
        zip_path = self.make_zip({
            "carpeta/Mi-Modelo-Q4_K_M.gguf": self.gguf(),
            "carpeta/mydgx.json": json.dumps(manifest).encode(),
            "carpeta/notas.txt": b"no se usa",
            "__MACOSX/carpeta/._Mi-Modelo-Q4_K_M.gguf": b"resource fork",
        })
        result = self.run_import(zip_path)
        self.assertEqual(result["repo_id"], "imported/Mi-Modelo-Nandu")
        self.assertEqual([item["role"] for item in result["files"]], ["main"])
        self.assertEqual(result["launch"]["model_filename"], "Mi-Modelo-Q4_K_M.gguf")
        launch_context = result["launch"]["context_size"]
        self.assertEqual(launch_context != 16384, any("settings.context_size=16384" in item for item in result["warnings"]))
        self.assertIn("Ignorado (no se usa): notas.txt", result["warnings"])
        listed = {item["repo_id"]: item for item in main_module.local_hf_models()}
        self.assertIn("imported/Mi-Modelo-Nandu", listed)
        self.assertEqual(
            main_module.model_overrides("huggingface:imported/Mi-Modelo-Nandu"),
            {"context_size": 16384, "temperature": 0.4},
        )
        self.assertIn("Un modelo de prueba", main_module.saved_model_description("imported/Mi-Modelo-Nandu")["description"])
        artifacts = [item for item in main_module.local_gguf_benchmark_artifacts() if item["repo_id"] == result["repo_id"]]
        self.assertEqual(len(artifacts), 1)
        again = self.run_import(self.make_zip({"Mi-Modelo-Q4_K_M.gguf": self.gguf()}, "Mi Modelo Ñandú.zip"))
        self.assertEqual(again["repo_id"], "imported/Mi-Modelo-Nandu-2")
        self.assertEqual(list((self.root / "hf" / "hub").glob(".mydgx-import-*")), [])

    def test_smoke_test_benchmark_is_not_blocked_by_its_own_import_job(self) -> None:
        zip_path = self.make_zip({"Modelo-Q8_0.gguf": self.gguf()})
        job_id = db.create_job("models.import", zip_path.name)
        result = main_module.extract_model_import(job_id, zip_path, zip_path.name)
        calls: list[dict[str, Any]] = []

        async def fake_run(benchmark_job: str, run_id: str, request: Any, **kwargs: Any) -> str:
            calls.append(kwargs)
            await main_module.assert_benchmark_isolation(
                benchmark_job, {}, True, parent_job_id=kwargs.get("parent_job_id"),
            )
            return "completed"

        with patch("backend.main.run_benchmark_job", side_effect=fake_run), \
                patch("backend.main.benchmark_runtime_busy", AsyncMock(return_value="")), \
                patch("backend.main.benchmark_ollama_residents", AsyncMock(return_value=[])):
            asyncio.run(main_module.model_import_smoke_test(job_id, result))
        self.assertEqual(calls, [{"parent_job_id": job_id}])

    def test_unsafe_or_incomplete_zips_are_rejected_without_leftovers(self) -> None:
        cases = {
            "traversal": ({"../fuera.gguf": self.gguf()}, "Ruta no permitida"),
            "no_gguf": ({"README.md": b"# hola"}, "ningún archivo .gguf"),
            "not_gguf": ({"Model-Q4_K_M.gguf": b"no soy un gguf" * 10}, "No son GGUF válidos"),
            "missing_shard": ({"Model-Q4_K_M-00001-of-00002.gguf": self.gguf()}, "faltan partes"),
            "bad_manifest": ({"Model.gguf": self.gguf(), "mydgx.json": b"{\"settings\": {\"context_size\": 10}}"}, "settings.context_size"),
            "missing_file": ({"Model.gguf": self.gguf(), "mydgx.json": b"{\"settings\": {\"mmproj_filename\": \"mmproj.gguf\"}}"}, "no está en el ZIP"),
        }
        for label, (entries, message) in cases.items():
            with self.subTest(label):
                with self.assertRaises(main_module.ModelImportError) as raised:
                    self.run_import(self.make_zip(entries, f"{label}.zip"))
                self.assertIn(message, str(raised.exception))
        hub = self.root / "hf" / "hub"
        self.assertEqual([item.name for item in hub.iterdir()] if hub.exists() else [], [])

    def test_symlinks_and_encrypted_members_are_refused(self) -> None:
        import zipfile

        path = self.root / "link.zip"
        with zipfile.ZipFile(path, "w") as archive:
            info = zipfile.ZipInfo("Model.gguf")
            info.external_attr = (0o120777 << 16)
            archive.writestr(info, "/etc/passwd")
        with self.assertRaisesRegex(main_module.ModelImportError, "enlaces simbólicos"):
            self.run_import(path)

    def test_upload_streams_the_zip_and_rejects_what_does_not_fit(self) -> None:
        client = TestClient(main_module.app)
        body = self.make_zip({"Tiny-Q8_0.gguf": self.gguf()}).read_bytes()
        with patch("backend.main.process_model_import", new=AsyncMock()) as process:
            response = client.post("/api/models/import/upload?filename=tiny.zip&run_test=false", content=body)
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()["job_id"]
        staged = Path(process.await_args.args[1])
        self.assertEqual(staged.read_bytes(), body)
        self.assertEqual(staged.stat().st_mode & 0o777, 0o600)
        self.assertEqual(db.rows("SELECT kind FROM jobs WHERE id=?", (job_id,))[0]["kind"], "models.import")
        self.assertEqual(client.post("/api/models/import/upload?filename=x.tar", content=b"x").status_code, 400)
        with patch("backend.main.model_import_limits", return_value={"max_upload_now_bytes": 10}):
            self.assertEqual(client.post("/api/models/import/upload?filename=big.zip", content=body).status_code, 413)


class SpeculativeDecodingTests(unittest.TestCase):
    def test_file_role_uses_name_header_and_tensor_count(self) -> None:
        main = {"general.architecture": "qwen35moe", "split.tensors.count": 800}
        cases = [
            ("mmproj-Model-F16.gguf", {}, "mmproj"),
            ("dspark-DeepSeek-V4.1-Flash-Q8_0.gguf", {}, "draft-dspark"),
            ("MTP/mtp-Qwen3.8-Flash-Next-Q4_K_M.gguf", {}, "draft-mtp"),
            ("Model-assistant.gguf", {"general.architecture": "dflash"}, "draft-dflash"),
            ("helper.gguf", {"general.architecture": "qwen35moe", "gguf.tensor_count": 40,
                             "qwen35moe.nextn_predict_layers": 1}, "draft-mtp"),
            ("tiny.gguf", {"general.architecture": "llama", "gguf.tensor_count": 30}, "draft-simple"),
            ("Model-IQ1_S.gguf", {"general.architecture": "qwen35moe", "split.tensors.count": 800}, "main"),
        ]
        for filename, metadata, expected in cases:
            with self.subTest(filename=filename):
                self.assertEqual(main_module.gguf_file_role(filename, metadata, main), expected)

    def test_named_drafter_prefers_dspark_and_q8(self) -> None:
        siblings = [
            SimpleNamespace(rfilename="MTP/mtp-Model-Q4_K_M.gguf", size=2),
            SimpleNamespace(rfilename="dspark-Model-Q4_K_M.gguf", size=4),
            SimpleNamespace(rfilename="dspark-Model-Q8_0.gguf", size=7),
            SimpleNamespace(rfilename="Model-Q4_K_M.gguf", size=80),
        ]
        drafter = main_module.hf_named_drafter(siblings)
        self.assertEqual((drafter["spec_type"], drafter["files"]), ("draft-dspark", ["dspark-Model-Q8_0.gguf"]))
        self.assertIsNone(main_module.hf_named_drafter(siblings[3:]))

    def test_partial_header_from_ranged_download(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "Model.gguf"
            write_test_gguf(path, 65_536, extra={"block_count": 40})
            data = path.read_bytes()
        cut = data[: len(data) - 4]
        metadata = main_module.parse_gguf_header(io.BytesIO(cut), partial=True)
        self.assertEqual(metadata["general.architecture"], "qwen35moe")
        self.assertEqual(metadata["qwen35moe.context_length"], 65_536)
        with self.assertRaises(ValueError):
            main_module.parse_gguf_header(io.BytesIO(cut))

    def test_large_tokenizer_is_skipped_across_read_blocks(self) -> None:
        def text(value: Any) -> bytes:
            raw = value.encode() if isinstance(value, str) else value
            return struct.pack("<Q", len(raw)) + raw

        tokens = [f"token-{index}".encode() for index in range(150_000)]
        tokens.insert(70_000, b"x" * (3 << 20))
        header = (
            text("general.architecture") + struct.pack("<I", 8) + text("llama")
            + text("tokenizer.ggml.tokens") + struct.pack("<IIQ", 9, 8, len(tokens))
            + b"".join(text(token) for token in tokens)
            + text("llama.context_length") + struct.pack("<II", 4, 131_072)
        )
        data = b"GGUF" + struct.pack("<IQQ", 3, 7, 3) + header
        metadata = main_module.parse_gguf_header(io.BytesIO(data))
        self.assertEqual(metadata["llama.context_length"], 131_072)
        self.assertEqual(metadata["gguf.tensor_count"], 7)
        self.assertNotIn("tokenizer.ggml.tokens", metadata)
        cut = main_module.parse_gguf_header(io.BytesIO(data[: len(data) // 2]), partial=True)
        self.assertEqual(cut["general.architecture"], "llama")
        self.assertNotIn("llama.context_length", cut)

    def test_weight_digest_survives_a_restart_until_the_file_changes(self) -> None:
        original_path = db.path
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "digests.db"
                db.initialize()
                weights = Path(directory) / "flux.safetensors"
                weights.write_bytes(b"a" * 64)
                stat = weights.stat()
                expected = hashlib.sha256(b"a" * 64).hexdigest()
                identity = (str(weights), stat.st_size, stat.st_mtime_ns)
                self.assertEqual(main_module.sha256_file_identity(*identity), expected)
                main_module.sha256_file_identity.cache_clear()
                weights.write_bytes(b"b" * 64)
                os.utime(weights, ns=(stat.st_atime_ns, stat.st_mtime_ns))
                self.assertEqual(main_module.sha256_file_identity(*identity), expected)
                main_module.sha256_file_identity.cache_clear()
                changed = weights.stat().st_mtime_ns + 1
                os.utime(weights, ns=(changed, changed))
                self.assertEqual(
                    main_module.sha256_file_identity(str(weights), 64, changed),
                    hashlib.sha256(b"b" * 64).hexdigest(),
                )
        finally:
            main_module.sha256_file_identity.cache_clear()
            db.path = original_path

    def test_card_setup_wins_when_its_drafter_is_local(self) -> None:
        card = "```bash\nllama-server -m Model-Q4_K_M.gguf --spec-type draft-mtp --spec-draft-n-max 3\n```"
        candidates = [
            {"spec_type": "draft-dspark", "draft_filename": "dspark-Model-Q8_0.gguf", "size": 7,
             "quantization": "Q8_0", "architecture": "dflash", "embedded": False},
            {"spec_type": "draft-mtp", "draft_filename": "", "size": 0, "quantization": "",
             "architecture": "qwen35moe", "embedded": True},
        ]
        with patch.object(main_module, "local_card_texts", return_value=[card]):
            self.assertEqual(
                main_module.choose_speculative("author/Model-GGUF", candidates),
                ({"spec_type": "draft-mtp", "draft_filename": "", "spec_draft_n_max": 3}, "ficha"),
            )
        with patch.object(main_module, "local_card_texts", return_value=[]):
            setup, origin = main_module.choose_speculative("author/Model-GGUF", candidates)
        self.assertEqual((setup["spec_type"], setup["draft_filename"], origin), ("draft-dspark", "dspark-Model-Q8_0.gguf", "archivo"))
        with patch.object(main_module, "local_card_texts", return_value=[]):
            self.assertEqual(main_module.choose_speculative("author/Model-GGUF", []), ({}, ""))

    def test_speculative_args_need_flag_and_drafter(self) -> None:
        model = {"spec_type": "draft-dspark", "draft_filename": "dspark-Model-Q8_0.gguf", "spec_draft_n_max": 4}
        draft = Path("/models/dspark-Model-Q8_0.gguf")
        with patch.object(main_module, "llama_supports_flag", return_value=True), \
                patch.object(main_module, "resolve_draft_file", return_value=draft):
            self.assertEqual(main_module.speculative_args("llama-server", model), [
                "--spec-type", "draft-dspark", "--spec-draft-model", str(draft),
                "--spec-draft-ngl", "all", "--spec-draft-n-max", "4",
            ])
        with patch.object(main_module, "llama_supports_flag", return_value=True), \
                patch.object(main_module, "resolve_draft_file", return_value=None):
            self.assertEqual(main_module.speculative_args("llama-server", model), [])
            self.assertEqual(
                main_module.speculative_args("llama-server", {"spec_type": "draft-mtp"}),
                ["--spec-type", "draft-mtp"],
            )
        with patch.object(main_module, "llama_supports_flag", return_value=False):
            self.assertEqual(main_module.speculative_args("llama-server", model), [])


class QuickContextTests(unittest.TestCase):
    def setUp(self) -> None:
        main_module._gguf_metadata_cached.cache_clear()

    def quick_config(
        self, home: Path, native: int, readme: str = "", task: str = "chat", requested: "int | None" = None,
    ) -> dict[str, Any]:
        snapshot = home / "hub" / "models--author--Model-GGUF" / "snapshots" / "abc"
        snapshot.mkdir(parents=True)
        write_test_gguf(snapshot / "Model-Q4_K_M.gguf", native)
        if readme:
            (snapshot / "README.md").write_text(readme, encoding="utf-8")
        config = {
            "name": "x", "model_alias": "author-model-gguf-global", "engine": "llama.cpp", "task": task,
            "model_repo": "author/Model-GGUF", "model_filename": "Model-Q4_K_M.gguf",
            "context_size": 8192, "estimated_memory_mb": 20_000,
        }
        with patch.object(main_module.settings, "hf_home", str(home)):
            return main_module.quick_model_config(config, "author/Model-GGUF", requested)

    def test_default_uses_the_slider_or_the_encender_context(self) -> None:
        for requested, expected in ((65_536, 65_536), (None, 81_920)):
            with self.subTest(requested=requested), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                snapshot = home / "hub" / "models--author--Model-GGUF" / "snapshots" / "abc"
                snapshot.mkdir(parents=True)
                write_test_gguf(snapshot / "Model-Q4_K_M.gguf", 131_072)
                base = {
                    "name": "x", "model_alias": "author-model-gguf-global", "engine": "llama.cpp", "task": "chat",
                    "model_repo": "author/Model-GGUF", "model_filename": "Model-Q4_K_M.gguf",
                    "context_size": 8192, "estimated_memory_mb": 20_000,
                }
                with patch.object(main_module.settings, "hf_home", str(home)), \
                        patch.object(main_module, "persistent_model_config", return_value=base):
                    config = asyncio.run(main_module.managed_model_config("huggingface", "author/Model-GGUF", requested))
                self.assertEqual(config["context_size"], expected)
                self.assertEqual(config["model_alias"], "author-model-gguf-global")

    def test_manual_context_caps_the_slider_and_sets_the_default(self) -> None:
        overrides = {"context_max": 65_536, "context_size": 40_000}
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(main_module, "model_overrides", return_value=overrides):
            config = self.quick_config(Path(directory), 131_072)
            self.assertEqual(config["context_size"], 39_936)
            with patch.object(main_module.settings, "hf_home", directory):
                self.assertEqual(main_module.quick_context_range(config)["context_max"], 65_536)

    def test_quick_uses_requested_context_within_limits(self) -> None:
        for requested, expected in ((65_000, 64_512), (1024, 32_768), (900_000, 131_072)):
            with self.subTest(requested=requested), tempfile.TemporaryDirectory() as directory:
                config = self.quick_config(Path(directory), 131_072, requested=requested)
                self.assertEqual(config["context_size"], expected)

    def test_quick_context_range_spans_agent_minimum_to_native(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = self.quick_config(home, 131_072)
            with patch.object(main_module.settings, "hf_home", str(home)):
                context = main_module.quick_context_range(config)
        self.assertEqual((context["context_min"], context["context_max"]), (32_768, 131_072))

    def test_card_context_below_agent_minimum_is_an_example_not_a_ceiling(self) -> None:
        readme = "```\nllama-server -m x.gguf -c 16384 --jinja\n```\n"
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = self.quick_config(home, 1_048_576, readme)
            with patch.object(main_module.settings, "hf_home", str(home)):
                context = main_module.quick_context_range(config)
        self.assertEqual(config["context_size"], 32_768)
        self.assertEqual((context["context_min"], context["context_max"]), (32_768, 1_048_576))

    def test_slider_reaches_native_when_card_recommends_less(self) -> None:
        readme = "```\nllama-server -m x.gguf --ctx-size 131072\n```\n"
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = self.quick_config(home, 1_048_576, readme)
            with patch.object(main_module.settings, "hf_home", str(home)):
                context = main_module.quick_context_range(config)
        self.assertEqual(config["context_size"], 81_920)
        self.assertEqual(context["context_max"], 1_048_576)

    def test_reads_native_context_from_gguf_header(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "m.gguf"
            write_test_gguf(path, 262_144)
            self.assertEqual(main_module.gguf_context_length(path), 262_144)
            path.write_bytes(b"NOPE" + b"\0" * 32)
            self.assertIsNone(main_module.gguf_context_length(path))

    def test_quick_uses_midpoint_of_agent_minimum_and_author_maximum(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.quick_config(Path(directory), 262_144, "```\nllama-server --jinja --ctx-size 262144 -fa on\n```\n")
        self.assertEqual(config["context_size"], 147_456)
        self.assertEqual(config["estimated_memory_mb"], 20_000 + 147_456 // 32 - 1024)

    def test_quick_falls_back_to_native_context_without_card(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.quick_config(Path(directory), 131_072)
        self.assertEqual(config["context_size"], 81_920)

    def test_large_model_defaults_to_minimum_but_keeps_native_slider_max(self) -> None:
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(main_module, "gguf_model_memory_mb", return_value=80_000), \
                patch.object(main_module.psutil, "virtual_memory", return_value=SimpleNamespace(total=122 * 1024**3)):
            home = Path(directory)
            config = self.quick_config(home, 1_048_576)
            with patch.object(main_module.settings, "hf_home", str(home)):
                context = main_module.quick_context_range(config)
        self.assertEqual(config["context_size"], 32_768)
        self.assertEqual(context["context_max"], 1_048_576)

    def test_quick_never_exceeds_native_context(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.quick_config(Path(directory), 16_384, "```\nllama-server -m x.gguf --ctx-size 262144\n```\n")
        self.assertEqual(config["context_size"], 16_384)

    def test_quick_keeps_context_for_other_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.quick_config(Path(directory), 262_144, task="embeddings")
        self.assertEqual(config["context_size"], 8192)

    def card_settings(self, readme: str) -> dict[str, Any]:
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "hub" / "models--author--Model-GGUF" / "snapshots" / "abc"
            snapshot.mkdir(parents=True)
            (snapshot / "README.md").write_text(readme, encoding="utf-8")
            with patch.object(main_module.settings, "hf_home", directory):
                return main_module.local_card_launch_settings("author/Model-GGUF")

    def test_card_sampling_and_kv_cache_from_author_commands(self) -> None:
        readme = (
            "Try `--temp 1.5` inline.\n\n```bash\nllama-server -hf author/Model-GGUF:Q4 \\\n"
            "  -ngl 99 --jinja --ctx-size 262144 \\\n  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0\n```\n\n"
            "```bash\nllama-server -hf author/Model-GGUF:Q4 -fa on -ctk q8_0 -ctv q8_0 \\\n"
            "  --temp 0.9 --top-k 40\n```\n"
        )
        self.assertEqual(self.card_settings(readme), {
            "temperature": 0.6, "top_p": 0.95, "top_k": 20, "min_p": 0.0,
            "repeat_penalty": 1.0, "cache_type_k": "q8_0", "cache_type_v": "q8_0",
        })

    def test_card_settings_reject_out_of_range_and_unknown_values(self) -> None:
        readme = "```\nllama-server -m x.gguf --temp 9 --top-p=0.8 --repeat-penalty 1.05 -ctk 'q8_0;id'\n```\n"
        self.assertEqual(self.card_settings(readme), {"top_p": 0.8, "repeat_penalty": 1.05})

    def test_prose_presets_from_base_card_follow_the_reasoning_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            hub = Path(directory) / "hub"
            own = hub / "models--author--Model-GGUF" / "snapshots" / "abc"
            base = hub / "models--org--Model" / "snapshots" / "def"
            own.mkdir(parents=True)
            base.mkdir(parents=True)
            (own / "README.md").write_text(
                "---\nbase_model:\n- org/Model\n---\nRun `nuclei -rl 2 -c 1000` against targets.\n", encoding="utf-8",
            )
            (base / "README.md").write_text(
                "We report max_tokens=32768, temperature=1.0 for evals.\n"
                "- Thinking Mode: `temperature=1.0`, `top_p=0.95`, `top_k=20`, `min_p=0.0`, `presence_penalty=0.0`, `repetition_penalty=1.0`\n"
                "- Instruct (or non-thinking) mode: `temperature=0.7`, `top_p=0.80`, `top_k=20`, `min_p=0.0`, `presence_penalty=1.5`, `repetition_penalty=1.0`\n",
                encoding="utf-8",
            )
            with patch.object(main_module.settings, "hf_home", directory):
                thinking = main_module.local_card_launch_settings("author/Model-GGUF")
                direct = main_module.local_card_launch_settings("author/Model-GGUF", reasoning_off=True)
                context = main_module.local_card_context("author/Model-GGUF")
        self.assertEqual(thinking, {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0.0, "presence_penalty": 0.0, "repeat_penalty": 1.0})
        self.assertEqual(direct["temperature"], 0.7)
        self.assertEqual(direct["presence_penalty"], 1.5)
        self.assertIsNone(context)

    def test_weight_counts_a_symlinked_snapshot_file_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            blob = Path(directory) / "blob"
            blob.write_bytes(b"\0" * (3 * 1024 * 1024))
            link = Path(directory) / "model.gguf"
            link.symlink_to(blob)
            with patch.object(main_module, "cached_hf_file", return_value=blob):
                weight = main_module.model_weight_mb({"model_file": str(link), "model_repo": "a/b", "model_filename": "model.gguf"})
        self.assertEqual(weight, 3)

    def test_weight_excludes_nvme_mapped_shared_engram_alias(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            snapshot = home / "hub" / "models--author--DeepSeek-GGUF" / "snapshots" / "abc"
            split = snapshot / "IQ2_XXS"
            split.mkdir(parents=True)
            names = []
            for index in range(1, 6):
                name = f"IQ2_XXS/DeepSeek-IQ2_XXS-{index:05d}-of-00006.gguf"
                (snapshot / name).write_bytes(b"\0" * (2 * 1024 * 1024))
                names.append(name)
            engram = snapshot / "DeepSeek-Engram-IQ4_NL.gguf"
            engram.write_bytes(b"\0" * (5 * 1024 * 1024))
            alias_name = "IQ2_XXS/DeepSeek-IQ2_XXS-00006-of-00006.gguf"
            (snapshot / alias_name).symlink_to("../DeepSeek-Engram-IQ4_NL.gguf")
            names.append(alias_name)
            with patch.object(main_module.settings, "hf_home", str(home)), \
                    patch.object(main_module, "cached_hf_file", side_effect=lambda _repo, filename: snapshot / filename):
                weight = main_module.model_weight_mb({
                    "model_repo": "author/DeepSeek-GGUF", "model_filename": names[0], "model_files": names,
                })
        self.assertEqual(weight, 10)

    def test_card_without_server_command_keeps_defaults(self) -> None:
        self.assertEqual(self.card_settings("Use temperature 0.6 and top_k 20."), {})
        self.assertEqual(self.card_settings("We report results at temperature=1.0."), {})

    def test_single_recommended_value_counts(self) -> None:
        settings = self.card_settings("**Note**: We recommond using a low temperature, such as `temperature=0.15`.")
        self.assertEqual(settings, {"temperature": 0.15, "repeat_penalty": 1.0})

    def test_kv_cache_counts_only_attention_blocks_and_cache_type(self) -> None:
        metadata = {"general.architecture": "qwen35moe", **{f"qwen35moe.{k}": v for k, v in QWEN35_MOE_SHAPE.items()}}
        # 10 attention blocks × 2 KV heads × (256 + 256) = 20 KiB/token at f16, plus ~63 MiB of SSM state.
        self.assertEqual(main_module.gguf_kv_cache_mb(metadata, 147_456), 2943)
        self.assertEqual(main_module.gguf_kv_cache_mb(metadata, 147_456, cache_type_k="q8_0", cache_type_v="q8_0"), 1593)

    def test_kv_cache_for_dense_model_scales_with_slots_only_per_slot(self) -> None:
        metadata = {
            "general.architecture": "llama", "llama.block_count": 80, "llama.embedding_length": 8192,
            "llama.attention.head_count": 64, "llama.attention.head_count_kv": 8,
        }
        self.assertEqual(main_module.gguf_kv_cache_mb(metadata, 32_768, parallel=2), 10_240)
        self.assertEqual(main_module.gguf_kv_cache_mb(metadata, 32_768, parallel=2, per_slot=True), 20_480)
        self.assertIsNone(main_module.gguf_kv_cache_mb({"general.architecture": "llama"}, 32_768))

    def test_kv_cache_sliding_window_layers_keep_only_the_window(self) -> None:
        pattern = [index % 6 != 5 for index in range(60)]
        metadata = {
            "general.architecture": "gemma4", "gemma4.block_count": 60, "gemma4.embedding_length": 5376,
            "gemma4.attention.head_count": 32,
            "gemma4.attention.head_count_kv": [16 if is_swa else 4 for is_swa in pattern],
            "gemma4.attention.key_length": 512, "gemma4.attention.value_length": 512,
            "gemma4.attention.key_length_swa": 256, "gemma4.attention.value_length_swa": 256,
            "gemma4.attention.sliding_window": 1024, "gemma4.attention.sliding_window_pattern": pattern,
        }
        # 10 full layers × 4 heads × 512 × 2 (K+V) × f16 = 80 KiB/token; 50 SWA layers × 16 × 256 × 2 × 2 over 1536 tokens.
        self.assertEqual(main_module.gguf_kv_cache_mb(metadata, 262_144), 20_480 + 1200)

    def test_gguf_sampling_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "m.gguf"
            write_test_gguf(path, 262_144, extra={
                "general.sampling.temp": 0.6, "general.sampling.top_p": 0.95,
                "general.sampling.top_k": 20, "general.sampling.min_p": 0.0,
            })
            self.assertEqual(main_module.gguf_sampling_settings(path), {
                "temperature": 0.6, "top_p": 0.95, "top_k": 20, "min_p": 0.0, "repeat_penalty": 1.0,
            })

    def test_quick_memory_estimate_uses_header_kv_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            snapshot = home / "hub" / "models--author--Model-GGUF" / "snapshots" / "abc"
            snapshot.mkdir(parents=True)
            write_test_gguf(snapshot / "Model-Q4_K_M.gguf", 262_144, extra=QWEN35_MOE_SHAPE)
            config = {
                "name": "x", "model_alias": "m-global", "engine": "llama.cpp", "task": "chat",
                "model_repo": "author/Model-GGUF", "model_filename": "Model-Q4_K_M.gguf",
                "context_size": 8192, "estimated_memory_mb": 1, "cache_type_k": "q8_0", "cache_type_v": "q8_0",
            }
            with patch.object(main_module.settings, "hf_home", str(home)), \
                    patch.object(main_module, "model_weight_mb", return_value=20_000), \
                    patch("backend.main.psutil.virtual_memory", return_value=SimpleNamespace(total=128 * 1024**3)):
                config = main_module.quick_model_config(config, "author/Model-GGUF")
        self.assertEqual(config["context_size"], 147_456)
        self.assertEqual(config["estimated_memory_mb"], math.ceil(20_000 * 1.12) + 1024 + 1593)


class BenchmarkTests(unittest.TestCase):
    def seed_benchmark_run(self, database: Database, run_id: str = "run-test") -> None:
        runtime = {"engine": "ollama", "model_ref": "example:latest"}
        now = datetime.now(timezone.utc).isoformat()
        job_id = database.create_job("benchmark.run", "ollama:example:latest")
        database.update_job(job_id, "completed", 100, "Benchmark válido")
        database.execute(
            """
            INSERT INTO benchmark_models(
                id,source,source_id,revision,filename,artifact_hash,artifact_size,
                quantization,architecture,metadata_json,card_text,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                "bm-test", "ollama", "example:latest", "", "",
                "b" * 64, 1024, "Q4_K_M", "Dense", "{}", "", now,
            ),
        )
        database.execute(
            """
            INSERT INTO benchmark_environments(
                id,environment_hash,hardware_json,software_json,created_at
            ) VALUES(?,?,?,?,?)
            """,
            ("env-test", "a" * 64, '{"device_model":"Test Spark"}', "{}", now),
        )
        database.execute(
            """
            INSERT INTO benchmark_runs(
                id,job_id,protocol_id,model_id,environment_id,target,runtime_hash,
                runtime_json,score_algorithm,score,status,valid,summary_json,
                created_at,started_at,completed_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id, job_id, main_module.BENCHMARK_PROTOCOL_ID, "bm-test", "env-test",
                "ollama:example:latest", main_module.content_hash(runtime),
                main_module.canonical_json(runtime), main_module.BENCHMARK_SCORE_ALGORITHM,
                80, "completed", 1, "{}", now, now, now,
            ),
        )
        for repetition, ttft, tps in ((1, 100, 20), (2, 120, 22), (3, 110, 21)):
            database.execute(
                """
                INSERT INTO benchmark_samples(
                    run_id,case_id,phase,repetition,started_at,ttft_ms,total_ms,
                    prompt_tokens,output_tokens,output_tps,chars_per_second,
                    output_chars,output_hash,native_metrics_json,valid,error
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    run_id, "interactive", "measured", repetition, now, ttft, 1000,
                    32, 20, tps, 80, 80, str(repetition) * 64, "{}", 1, "",
                ),
            )
        database.execute(
            """
            INSERT INTO benchmark_telemetry(
                run_id,created_at,cpu_percent,memory_used,gpu_utilization,
                gpu_memory_used,gpu_temperature,gpu_power_watts
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (run_id, now, 20, 1024, 90, 512, 55, 50),
        )

    def test_database_initializes_immutable_benchmark_protocol(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(str(Path(directory) / "benchmarks.db"))
            database.initialize()
            protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.BENCHMARK_PROTOCOL_ID,),
            )[0]
            self.assertEqual(protocol["version"], 1)
            self.assertEqual(
                protocol["definition_hash"],
                main_module.content_hash(main_module.BENCHMARK_PROTOCOL),
            )
            asr_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.ASR_BENCHMARK_PROTOCOL_ID,),
            )[0]
            self.assertEqual(asr_protocol["modality"], "automatic-speech-recognition")
            self.assertEqual(
                asr_protocol["definition_hash"],
                main_module.content_hash(main_module.ASR_BENCHMARK_PROTOCOL),
            )
            image_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.IMAGE_BENCHMARK_PROTOCOL_ID,),
            )[0]
            self.assertEqual(image_protocol["modality"], "image-generation")
            self.assertEqual(
                image_protocol["definition_hash"],
                main_module.content_hash(main_module.IMAGE_BENCHMARK_PROTOCOL),
            )
            video_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.VIDEO_BENCHMARK_PROTOCOL_ID,),
            )[0]
            self.assertEqual(video_protocol["modality"], "video-generation")
            self.assertEqual(
                video_protocol["definition_hash"],
                main_module.content_hash(main_module.VIDEO_BENCHMARK_PROTOCOL),
            )
            embeddings_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.EMBEDDINGS_BENCHMARK_PROTOCOL_ID,),
            )[0]
            reranking_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.RERANKING_BENCHMARK_PROTOCOL_ID,),
            )[0]
            self.assertEqual(embeddings_protocol["modality"], "embeddings")
            self.assertEqual(reranking_protocol["modality"], "reranking")
            self.assertEqual(
                embeddings_protocol["definition_hash"],
                main_module.content_hash(main_module.EMBEDDINGS_BENCHMARK_PROTOCOL),
            )
            self.assertEqual(
                reranking_protocol["definition_hash"],
                main_module.content_hash(main_module.RERANKING_BENCHMARK_PROTOCOL),
            )
            vision_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.VISION_BENCHMARK_PROTOCOL_ID,),
            )[0]
            tts_protocol = database.rows(
                "SELECT * FROM benchmark_protocols WHERE id=?",
                (main_module.TTS_BENCHMARK_PROTOCOL_ID,),
            )[0]
            self.assertEqual(vision_protocol["modality"], "vision")
            self.assertEqual(tts_protocol["modality"], "text-to-speech")
            self.assertEqual(
                vision_protocol["definition_hash"],
                main_module.content_hash(main_module.VISION_BENCHMARK_PROTOCOL),
            )
            self.assertEqual(
                tts_protocol["definition_hash"],
                main_module.content_hash(main_module.TTS_BENCHMARK_PROTOCOL),
            )
            tables = {
                row["name"]
                for row in database.rows("SELECT name FROM sqlite_master WHERE type='table'")
            }
            self.assertIn("benchmark_runs", tables)
            self.assertIn("benchmark_samples", tables)
            self.assertIn("benchmark_telemetry", tables)

    def test_benchmark_summary_uses_only_measured_samples(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "summary.db"
            db.initialize()
            self.seed_benchmark_run(db)
            summary = main_module.benchmark_summary("run-test")
            self.assertEqual(summary["sample_count"], 3)
            self.assertEqual(summary["valid_sample_count"], 3)
            self.assertEqual(summary["ttft_ms"]["p50"], 110)
            self.assertEqual(summary["output_tokens_per_second"]["mean"], 21)
            self.assertGreater(summary["score"], 0)
            self.assertEqual(summary["resources"]["joules_per_output_token"], 2.5)
        db.path = original_path

    def test_ollama_stream_benchmark_measures_first_token_and_native_tps(self) -> None:
        class FakeResponse:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                yield json.dumps({"message": {"content": "hola "}, "done": False})
                yield json.dumps({
                    "message": {"content": "mundo"},
                    "done": True,
                    "prompt_eval_count": 8,
                    "eval_count": 2,
                    "eval_duration": 100_000_000,
                })

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def stream(self, *_args, **_kwargs):
                return FakeResponse()

        with patch("backend.main.httpx.AsyncClient", return_value=FakeClient()):
            result = asyncio.run(main_module.execute_benchmark_sample(
                {
                    "engine": "ollama",
                    "model_ref": "example:latest",
                    "timeout_seconds": 30,
                },
                {"prompt": "test", "max_tokens": 16},
            ))
        self.assertTrue(result["valid"])
        self.assertEqual(result["output_tokens"], 2)
        self.assertEqual(result["output_tps"], 20)
        self.assertIsNotNone(result["ttft_ms"])
        self.assertEqual(len(result["output_hash"]), 64)

    def test_asr_sample_posts_multipart_and_measures_quality_and_rtf(self) -> None:
        captured: dict[str, object] = {}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "text": "I'm going to step off the LM now.",
                    "duration": 12.0,
                }

        class FakeClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, **kwargs):
                captured["url"] = url
                captured.update(kwargs)
                return FakeResponse()

        fixture = {
            "id": "armstrong-en",
            "filename": "armstrong-en.wav",
            "sha256": "a" * 64,
            "duration_seconds": 12.0,
            "language": "en",
            "reference": "I'm going to step off the LM now.",
        }
        with (
            patch(
                "backend.main.resolve_asr_fixture",
                new=AsyncMock(return_value=(fixture, b"RIFF-not-silence")),
            ),
            patch("backend.main.httpx.AsyncClient", FakeClient),
        ):
            result = asyncio.run(main_module.execute_benchmark_sample(
                {
                    "engine": "whisper",
                    "task": "asr",
                    "model_ref": "turbo",
                    "endpoint_url": "http://127.0.0.1:9000",
                    "timeout_seconds": 30,
                },
                {"fixture": "armstrong-en"},
            ))
        self.assertTrue(result["valid"])
        self.assertEqual(result["native"]["wer"], 0)
        self.assertEqual(result["native"]["cer"], 0)
        self.assertGreaterEqual(result["native"]["rtf"], 0)
        self.assertEqual(len(result["output_hash"]), 64)
        self.assertEqual(
            captured["url"],
            "http://127.0.0.1:9000/v1/audio/transcriptions",
        )
        self.assertEqual(captured["data"]["response_format"], "verbose_json")
        self.assertIn("file", captured["files"])

    def test_asr_edit_rates_are_reproducibly_normalized(self) -> None:
        self.assertEqual(
            main_module.asr_edit_rate("Hello, WORLD!", "hello world"),
            0,
        )
        self.assertAlmostEqual(
            main_module.asr_edit_rate("one two three", "one too three"),
            1 / 3,
        )
        self.assertGreater(
            main_module.asr_edit_rate("speech", "silence", characters=True),
            0,
        )

    def test_vision_fixture_and_openai_sample_measure_concept_recall(self) -> None:
        fixture = main_module.generated_vision_fixture()
        inspected = main_module.inspect_png(fixture, 256, 192)
        self.assertEqual(inspected["png_sha256"], main_module.VISION_FIXTURE_SHA256)

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "choices": [{
                        "message": {"content": "A red square and a blue circle."},
                    }],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 8},
                }

        class FakeClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, **kwargs):
                self.url = url
                self.payload = kwargs["json"]
                return FakeResponse()

        with patch("backend.main.httpx.AsyncClient", FakeClient):
            result = asyncio.run(main_module.execute_vision_benchmark_sample(
                {
                    "engine": "llama.cpp",
                    "task": "vision",
                    "model_ref": "vision-local",
                    "model_alias": "vision-local",
                    "port": 18080,
                },
                main_module.VISION_BENCHMARK_PROTOCOL["cases"][0],
            ))
        self.assertTrue(result["valid"])
        self.assertEqual(result["native"]["normalized_concept_recall"], 1)
        serialized = main_module.canonical_json(result)
        self.assertNotIn("A red square and a blue circle.", serialized)

    def test_tts_sample_inspects_audio_and_degrades_without_local_whisper(self) -> None:
        sample_rate = 16_000
        samples = [
            int(4000 * math.sin(2 * math.pi * 440 * index / sample_rate))
            for index in range(sample_rate // 10)
        ]
        pcm = b"".join(struct.pack("<h", value) for value in samples)
        wav = (
            b"RIFF"
            + struct.pack("<I", 36 + len(pcm))
            + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
            + b"data"
            + struct.pack("<I", len(pcm))
            + pcm
        )
        multimodal = {
            "content_type": "audio/wav",
            "data_base64": base64.b64encode(wav).decode("ascii"),
        }
        model = {
            "engine": "openai-compatible",
            "task": "tts",
            "model_ref": "tts-local",
            "model_alias": "tts-local",
            "endpoint_url": "http://127.0.0.1:8010/v1",
            "api_protocol": "openai",
        }
        with (
            patch(
                "backend.main.execute_multimodal_request",
                new=AsyncMock(return_value=multimodal),
            ) as execute,
            patch(
                "backend.main.whisper_service_benchmark_models",
                new=AsyncMock(return_value=[]),
            ),
        ):
            result = asyncio.run(main_module.execute_tts_benchmark_sample(
                model,
                main_module.TTS_BENCHMARK_PROTOCOL["cases"][0],
            ))
        self.assertTrue(result["valid"])
        self.assertTrue(result["native"]["audio_integrity"])
        self.assertFalse(result["native"]["intelligibility_available"])
        self.assertGreater(result["native"]["duration_seconds"], 0)
        execute.assert_awaited_once()
        payload = execute.await_args.args[0]
        self.assertEqual(payload.response_format, "wav")
        summary = main_module.tts_benchmark_summary([{
            "valid": 1,
            "total_ms": result["total_ms"],
            "native_metrics_json": main_module.canonical_json(result["native"]),
        }])
        self.assertTrue(summary["score_provisional"])
        self.assertEqual(summary["score_dimensions"]["intelligibility"], 0)
        self.assertIn("sin afirmación", summary["intelligibility"]["quality_claim"])

    def test_ollama_vision_capability_resolves_separate_protocol_task(self) -> None:
        tags = {"models": [{"name": "llava:latest", "digest": "a" * 64, "size": 10}]}

        async def payload(path, method="GET", body=None, timeout=30):
            if path == "/api/tags":
                return tags
            if path == "/api/show":
                return {"capabilities": ["completion", "vision"]}
            if path == "/api/version":
                return {"version": "test"}
            raise AssertionError(path)

        with patch("backend.main.ollama_payload", new=AsyncMock(side_effect=payload)):
            resolved = asyncio.run(
                main_module.resolve_benchmark_target("ollama:llava:latest")
            )
        self.assertEqual(resolved["task"], "vision")
        self.assertIn("image", resolved["input_modalities"])

    def test_ollama_embedding_capability_uses_embeddings_protocol(self) -> None:
        tags = {"models": [{"name": "nomic-embed:latest", "digest": "a" * 64, "size": 10}]}

        async def payload(path, method="GET", body=None, timeout=30):
            if path == "/api/tags":
                return tags
            if path == "/api/show":
                return {"capabilities": ["embedding"]}
            if path == "/api/version":
                return {"version": "test"}
            raise AssertionError(path)

        with (
            patch("backend.main.ollama_payload", new=AsyncMock(side_effect=payload)),
            patch("backend.main.profile_model_is_downloaded", return_value=False),
            patch("backend.main.whisper_service_benchmark_models", new=AsyncMock(return_value=[])),
            patch("backend.main.managed_comfyui_enabled", return_value=False),
            patch("backend.main.benchmark_artifact_completed_in_suite", return_value=False),
            patch("backend.main.benchmark_artifact_was_measured", return_value=False),
        ):
            resolved = asyncio.run(
                main_module.resolve_benchmark_target("ollama:nomic-embed:latest")
            )
            candidates = asyncio.run(main_module.benchmark_suite_candidates())
        self.assertEqual(resolved["task"], "embeddings")
        candidate = next(
            item for item in candidates
            if item["target"] == "ollama:nomic-embed:latest"
        )
        self.assertEqual(candidate["protocol_id"], main_module.EMBEDDINGS_BENCHMARK_PROTOCOL_ID)

    def test_pending_benchmarks_counts_only_runnable_candidates(self) -> None:
        candidates = [
            {"target": "a"},
            {"target": "b", "runnable": True},
            {"target": "c", "runnable": False},
            {"target": "d", "runnable": True, "suite_completed": True},
        ]
        with patch("backend.main.benchmark_suite_candidates", new=AsyncMock(return_value=candidates)) as listed:
            self.assertEqual(asyncio.run(main_module.benchmarks_pending()), {"pending": 2})
        listed.assert_awaited_once_with(include_measured=True)

    def test_embeddings_sample_measures_cosine_margin_without_persisting_text(self) -> None:
        case = main_module.EMBEDDINGS_BENCHMARK_PROTOCOL["cases"][0]
        vectors = [
            [1.0, 0.0], [0.99, 0.01],
            [0.0, 1.0], [0.01, 0.99],
            [-0.7, -0.7], [-1.0, 0.0],
        ]

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "data": [
                        {"index": index, "embedding": vector}
                        for index, vector in enumerate(vectors)
                    ]
                }

        class FakeClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, **kwargs):
                self.url = url
                self.payload = kwargs["json"]
                return FakeResponse()

        with patch("backend.main.httpx.AsyncClient", FakeClient):
            result = asyncio.run(main_module.execute_benchmark_sample(
                {
                    "engine": "openai-compatible",
                    "task": "embeddings",
                    "model_ref": "embed-local",
                    "endpoint_url": "http://127.0.0.1:9010",
                },
                case,
            ))
        serialized = main_module.canonical_json(result)
        self.assertTrue(result["valid"])
        self.assertGreater(result["native"]["semantic_margin"], case["required_margin"])
        self.assertGreater(result["native"]["items_per_second"], 0)
        self.assertNotIn(case["texts"][0], serialized)
        self.assertEqual(len(result["output_hash"]), 64)

    def test_reranking_sample_measures_ndcg_and_rejects_remote_endpoint(self) -> None:
        case = main_module.RERANKING_BENCHMARK_PROTOCOL["cases"][0]

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "results": [
                        {"index": 1, "relevance_score": 0.8},
                        {"index": 0, "relevance_score": 0.9},
                        {"index": 2, "relevance_score": 0.2},
                        {"index": 3, "relevance_score": 0.1},
                    ]
                }

        class FakeClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                return FakeResponse()

        model = {
            "engine": "openai-compatible",
            "task": "reranking",
            "model_ref": "reranker-local",
            "endpoint_url": "http://localhost:9020",
        }
        with patch("backend.main.httpx.AsyncClient", FakeClient):
            result = asyncio.run(main_module.execute_benchmark_sample(model, case))
        self.assertTrue(result["valid"])
        self.assertEqual(result["native"]["ndcg"], 1)
        self.assertEqual(result["native"]["mrr"], 1)
        self.assertNotIn(case["query"], main_module.canonical_json(result))
        with self.assertRaises(ValueError):
            asyncio.run(main_module.execute_benchmark_sample(
                {**model, "endpoint_url": "https://api.example.com"},
                case,
            ))

    def test_semantic_inventory_requires_local_resolvable_configuration(self) -> None:
        local = {
            "engine": "openai-compatible",
            "task": "embeddings",
            "model_ref": "embed-local",
            "endpoint_url": "http://127.0.0.1:9010",
        }
        first = main_module.semantic_profile_artifact(local, {})
        second = main_module.semantic_profile_artifact(local, {})
        remote = main_module.semantic_profile_artifact(
            {**local, "endpoint_url": "https://api.example.com"},
            {},
        )
        self.assertIsNotNone(first)
        self.assertEqual(first, second)
        self.assertIsNone(remote)

    def test_suite_inventory_includes_local_whisper_with_protocol_identity(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "asr-candidates.db"
            db.initialize()
            whisper_model = {
                "id": "turbo",
                "name": "Whisper Turbo",
                "engine": "whisper",
                "model_ref": "turbo",
                "model_alias": "turbo",
                "model_repo": "openai/whisper-large-v3-turbo",
                "task": "asr",
                "endpoint_url": "http://127.0.0.1:9000",
                "_benchmark_target": "whisper:turbo",
                "_benchmark_artifact_digest": "9" * 64,
                "_benchmark_artifact_size": 1024,
            }
            with (
                patch("backend.main.ollama_payload", new=AsyncMock(return_value={"models": []})),
                patch(
                    "backend.main.whisper_service_benchmark_models",
                    new=AsyncMock(return_value=[whisper_model]),
                ),
            ):
                candidates = asyncio.run(main_module.benchmark_suite_candidates())
        db.path = original_path
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["protocol_id"], main_module.ASR_BENCHMARK_PROTOCOL_ID)
        self.assertEqual(candidates[0]["modality"], "automatic-speech-recognition")
        self.assertEqual(candidates[0]["artifact_hash"], "9" * 64)
        self.assertEqual(
            main_module.normalized_whisper_model_id("whisper-large-v3"),
            "large-v3",
        )

    def test_comfyui_models_count_as_loaded_only_while_really_resident(self) -> None:
        history = {"p1": {
            "status": {"status_str": "success"},
            "prompt": [0, "p1", {"1": {"inputs": {"unet_name": "wan/wan2.1_t2v.safetensors"}}}, {"create_time": 2_000_000}],
        }}
        response = httpx.Response(200, json=history, request=httpx.Request("GET", "http://127.0.0.1:8188/history"))

        def files(started_at: float, resident: int, freed_at: float) -> set[str]:
            process = {"kind": "comfyui", "started_at": started_at, "anon_bytes": resident, "shared_bytes": 0}
            with (
                patch.object(main_module, "_comfyui_freed_at", freed_at),
                patch("backend.main.httpx.AsyncClient.get", new=AsyncMock(return_value=response)),
                patch("backend.main.comfyui_component_bytes", return_value=10 * 1024**3),
            ):
                return asyncio.run(main_module.comfyui_loaded_model_files([process]))

        self.assertEqual(files(1_000, 9 * 1024**3, 0), {"wan2.1_t2v.safetensors"})
        self.assertEqual(files(1_000, 9 * 1024**3, 2_500), set())
        self.assertEqual(files(3_000, 9 * 1024**3, 0), set())
        self.assertEqual(files(1_000, 3 * 1024**3, 0), set())

    def test_memory_breakdown_attributes_every_byte_of_unified_memory(self) -> None:
        gib = 1024**3
        meminfo = {
            "MemTotal": 120 * gib, "MemFree": 10 * gib, "MemAvailable": 70 * gib,
            "Buffers": 1 * gib, "Cached": 60 * gib, "SReclaimable": 2 * gib, "Shmem": 3 * gib,
        }
        processes = [{
            "pid": 4242, "kind": "llama-server", "name": "llama-server", "alias": "bughunter",
            "started_at": 1.0, "anon_bytes": 1 * gib, "file_bytes": 0, "shared_bytes": 1 * gib,
            "device_bytes": 33 * gib, "bytes": 35 * gib,
        }]
        with (
            patch("backend.main.meminfo_bytes", return_value=meminfo),
            patch("backend.main.memory_runtime_processes", return_value=processes),
            patch("backend.main.whisper_runtime_snapshot", new=AsyncMock(return_value={"loaded_models": []})),
            patch("backend.main.managed_tts_health", new=AsyncMock(return_value=None)),
            patch("backend.main.benchmark_ollama_residents", new=AsyncMock(return_value=set())),
            patch("backend.main.comfyui_loaded_model_files", new=AsyncMock(return_value=set())),
        ):
            memory = asyncio.run(main_module.memory_breakdown())
        runtime = memory["runtimes"][0]
        self.assertEqual(runtime["name"], "llama-server · bughunter (fuera de MyDGX)")
        self.assertFalse(runtime["managed"])
        self.assertEqual(memory["cache_bytes"], 60 * gib)
        self.assertEqual(
            memory["free"] + memory["cache_bytes"] + memory["system_bytes"]
            + memory["driver_bytes"] + runtime["bytes"],
            memory["total"],
        )

    def test_memory_mode_stops_active_optional_services_and_restores_them(self) -> None:
        calls: list[tuple[str, str]] = []

        async def fake_set(service_id: str, action: str) -> None:
            calls.append((service_id, action))

        status = AsyncMock(return_value={"services": []})
        stopped_profiles: list[str] = []
        started_profiles: list[str] = []

        async def fake_stop_profile(profile_id: str) -> None:
            stopped_profiles.append(profile_id)

        async def fake_start_profile(profile: dict[str, Any], **_: Any) -> dict[str, Any]:
            started_profiles.append(profile["id"])
            return {}

        db_rows = db.rows

        def fake_rows(query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
            if "benchmark_suites" in query:
                return []
            if query.startswith("SELECT * FROM profiles WHERE id=?"):
                return [{"id": params[0], "name": "Cyber-Tiel"}]
            return db_rows(query, params)

        with tempfile.TemporaryDirectory() as directory, (
            patch.object(main_module, "_runtime_profile_ids", ["tiel"])
        ), patch("backend.main.stop_runtime_profile", new=fake_stop_profile), (
            patch("backend.main.start_profile_process", new=fake_start_profile)
        ), patch("backend.main.running_profiles", return_value=[]), (
            patch.object(main_module.db, "rows", side_effect=fake_rows)
        ), (
            patch.object(main_module, "MEMORY_MODE_STATE_FILE", Path(directory) / "memory-mode.json")
        ), (
            patch("backend.main.optional_service_active", side_effect=lambda item: item != "searxng")
        ), patch("backend.main.set_optional_service", new=fake_set), (
            patch("backend.main.release_all_ollama_models", new=AsyncMock(return_value=["llama3.2:3b"]))
        ), patch("backend.main.drop_page_cache", new=AsyncMock(return_value=True)), (
            patch("backend.main.wait_for_memory_recovery", new=AsyncMock())
        ), patch("backend.main.meminfo_bytes", return_value={"MemFree": 1}), (
            patch("backend.main.memory_mode_status", new=status)
        ):
            with self.assertRaises(HTTPException):
                asyncio.run(main_module.memory_mode_release(
                    main_module.MemoryModeReleaseRequest(services=["comfyui"], confirm="si")
                ))
            result = asyncio.run(main_module.memory_mode_release(main_module.MemoryModeReleaseRequest(
                services=["comfyui", "searxng", "open-webui"], stop_profiles=True, confirm="liberar memoria",
            )))
            self.assertEqual(result["released_ollama"], ["llama3.2:3b"])
            self.assertEqual(calls, [("comfyui", "stop"), ("open-webui", "stop")])
            self.assertEqual(stopped_profiles, ["tiel"])
            state = main_module.memory_mode_state()
            self.assertEqual((state["stopped"], state["profiles"]), (["comfyui", "open-webui"], ["tiel"]))
            calls.clear()
            with patch("backend.main.running_profiles", return_value=[{"id": "big", "name": "Modelo 100 GB"}]):
                blocked = asyncio.run(main_module.memory_mode_restore(
                    main_module.MemoryModeConfirmRequest(confirm="restaurar servicios")
                ))
            self.assertIn("Modelo 100 GB", blocked["errors"][0])
            self.assertEqual(started_profiles, [])
            self.assertEqual(main_module.memory_mode_state()["profiles"], ["tiel"])
            with patch.object(main_module, "_runtime_profile_ids", []):
                asyncio.run(main_module.memory_mode_restore(
                    main_module.MemoryModeConfirmRequest(confirm="restaurar servicios")
                ))
            self.assertEqual(calls, [("comfyui", "start"), ("open-webui", "start")])
            self.assertEqual(started_profiles, ["tiel"])
            self.assertEqual(main_module.memory_mode_state(), {"stopped": [], "profiles": [], "since": None})

    def test_cuda_device_mappings_are_not_mistaken_for_page_cache(self) -> None:
        smaps = (
            "7f0000000000-7f0800000000 rw-s 00000000 00:05 12 /dev/nvidia-uvm\n"
            "Size:           33554432 kB\nRss:            33554432 kB\n"
            "7f0900000000-7f0900100000 r--p 00000000 08:01 99 /home/u/model.gguf\n"
            "Size:               1024 kB\nRss:                1024 kB\n"
            "7f0a00000000-7f0a00100000 rw-p 00000000 00:00 0 \n"
            "Size:               1024 kB\nRss:                 512 kB\n"
        )
        with patch("builtins.open", mock_open(read_data=smaps)):
            self.assertEqual(main_module.process_device_rss(1), 32 * 1024**3)

    def test_page_cache_is_dropped_only_when_model_does_not_fit_in_free_memory(self) -> None:
        gib = 1024**3
        with (
            patch("backend.main.meminfo_bytes", return_value={"MemFree": 40 * gib}),
            patch("backend.main.drop_page_cache", new=AsyncMock(return_value=True)) as drop,
        ):
            self.assertFalse(asyncio.run(main_module.prepare_memory_for_model("pequeño", 10 * gib)))
            drop.assert_not_awaited()
            self.assertTrue(asyncio.run(main_module.prepare_memory_for_model("grande", 80 * gib)))
            drop.assert_awaited_once()

    def test_external_whisper_profile_is_served_by_managed_whisper_repo(self) -> None:
        original_path = db.path
        repo = "dropbox-dash/faster-whisper-large-v3-turbo"
        service_model = {
            "id": repo,
            "name": repo,
            "engine": "whisper",
            "model_ref": repo,
            "model_alias": repo,
            "model_repo": repo,
            "task": "asr",
            "endpoint_url": "http://127.0.0.1:9000",
            "_benchmark_target": f"whisper:{repo}",
            "_benchmark_artifact_digest": "7" * 64,
            "_benchmark_artifact_size": 2048,
            "_benchmark_runtime_version": "20250625",
        }
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "asr-managed.db"
            try:
                with TestClient(app) as client:
                    self.assertEqual(client.post("/api/profiles", json={
                        "name": "Voice agent",
                        "engine": "whisper",
                        "model_ref": repo,
                        "model_alias": "voice-agent-whisper",
                        "port": 18101,
                        "task": "asr",
                        "input_modalities": ["audio"],
                        "output_modalities": ["text"],
                        "runtime_backend": "external",
                        "endpoint_url": "http://127.0.0.1:8101",
                    }).status_code, 200)
                with (
                    patch("backend.main.ollama_payload", new=AsyncMock(return_value={"models": []})),
                    patch("backend.main.whisper_service_benchmark_models", new=AsyncMock(return_value=[service_model])),
                    patch("backend.main.external_endpoint_reachable", new=AsyncMock(return_value=False)),
                    patch("backend.main.managed_comfyui_enabled", return_value=False),
                ):
                    candidates = asyncio.run(main_module.benchmark_suite_candidates())
            finally:
                db.path = original_path
        asr = [item for item in candidates if item["protocol_id"] == main_module.ASR_BENCHMARK_PROTOCOL_ID]
        self.assertEqual(len(asr), 1)
        self.assertEqual(asr[0]["target"], f"whisper:{repo}")
        self.assertTrue(asr[0]["runnable"])

    def test_suite_inventory_includes_only_real_managed_flux_checkpoint(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "image-candidates.db"
            db.initialize()
            checkpoint = Path(directory) / "flux1-schnell-fp8.safetensors"
            checkpoint.write_bytes(b"real-checkpoint")
            flux = {
                **main_module.COMFYUI_MANAGED_MODELS["comfyui-image"],
                "model_file": str(checkpoint),
                "model_filename": checkpoint.name,
                "_benchmark_target": "comfyui:flux1-schnell-fp8",
                "_benchmark_artifact_digest": main_module.hashlib.sha256(
                    checkpoint.read_bytes()
                ).hexdigest(),
                "_benchmark_artifact_size": checkpoint.stat().st_size,
            }
            with (
                patch("backend.main.ollama_payload", new=AsyncMock(return_value={"models": []})),
                patch("backend.main.whisper_service_benchmark_models", new=AsyncMock(return_value=[])),
                patch("backend.main.managed_comfyui_enabled", return_value=True),
                patch("backend.main.managed_flux_benchmark_model", return_value=flux),
            ):
                candidates = asyncio.run(main_module.benchmark_suite_candidates())
        db.path = original_path
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["target"], "comfyui:flux1-schnell-fp8")
        self.assertEqual(candidates[0]["protocol_id"], main_module.IMAGE_BENCHMARK_PROTOCOL_ID)
        self.assertEqual(candidates[0]["modality"], "image-generation")

    def test_image_sample_validates_png_resolution_and_fixed_parameters(self) -> None:
        def chunk(kind: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + kind
                + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
            )

        width, height = 2, 2
        pixels = b"\x00\xff\x00\x00\xff\x00\x00" * height
        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels))
            + chunk(b"IEND", b"")
        )
        execute = AsyncMock(return_value={
            "content_type": "image/png",
            "data_base64": base64.b64encode(png).decode("ascii"),
        })
        case = {
            "prompt": "fixed",
            "seed": 42,
            "width": width,
            "height": height,
            "steps": 4,
        }
        with patch("backend.main.execute_managed_comfyui", new=execute):
            first = asyncio.run(main_module.execute_image_benchmark_sample(
                {
                    "engine": "comfyui",
                    "endpoint_url": "http://127.0.0.1:8188",
                    "timeout_seconds": 30,
                },
                case,
            ))
            second = asyncio.run(main_module.execute_image_benchmark_sample(
                {
                    "engine": "comfyui",
                    "endpoint_url": "http://127.0.0.1:8188",
                    "timeout_seconds": 30,
                },
                case,
            ))
        self.assertTrue(first["valid"])
        self.assertTrue(first["native"]["png_integrity"])
        self.assertTrue(first["native"]["resolution_matches"])
        self.assertEqual(first["native"]["pixel_sha256"], second["native"]["pixel_sha256"])
        self.assertEqual(execute.await_args.kwargs["seed"], 42)
        self.assertEqual(execute.await_args.kwargs["steps"], 4)
        self.assertFalse(execute.await_args.kwargs["persist_output"])

    def test_image_summary_scores_reproducibility_not_merely_success(self) -> None:
        samples = [
            {
                "valid": 1,
                "total_ms": 1000,
                "native_metrics_json": main_module.canonical_json({
                    "png_integrity": True,
                    "resolution_matches": True,
                    "pixel_sha256": digest,
                }),
            }
            for digest in ("a" * 64, "b" * 64)
        ]
        summary = main_module.image_benchmark_summary(samples)
        self.assertEqual(summary["valid_sample_count"], 2)
        self.assertEqual(summary["image_validation"]["pixel_reproducibility_percent"], 50)
        self.assertEqual(summary["score_dimensions"]["pixel_reproducibility"], 50)
        self.assertEqual(summary["score_algorithm"], main_module.IMAGE_BENCHMARK_SCORE_ALGORITHM)

    def test_managed_wan_requires_all_real_components_and_composite_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            models = root / "source" / "models"
            files = {
                "diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors": b"diffusion",
                "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors": b"encoder",
                "vae/wan_2.1_vae.safetensors": b"vae",
            }
            for relative, content in files.items():
                path = models / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            with patch("backend.main.managed_comfyui_root", return_value=root):
                first = main_module.managed_wan_benchmark_model()
                (models / "vae" / "wan_2.1_vae.safetensors").write_bytes(b"changed-vae")
                second = main_module.managed_wan_benchmark_model()
                (models / "text_encoders" / "umt5_xxl_fp8_e4m3fn_scaled.safetensors").unlink()
                missing = main_module.managed_wan_benchmark_model()
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(len(first["_benchmark_artifact_components"]), 3)
        self.assertNotEqual(
            first["_benchmark_artifact_digest"],
            second["_benchmark_artifact_digest"],
        )
        self.assertIsNone(missing)

    def test_suite_inventory_includes_complete_managed_wan_only(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "video-candidates.db"
            db.initialize()
            wan = {
                **main_module.COMFYUI_MANAGED_MODELS["comfyui-video"],
                "model_filename": "diffusion, encoder, vae",
                "_benchmark_target": "comfyui:wan2.1-t2v-1.3b",
                "_benchmark_artifact_digest": "7" * 64,
                "_benchmark_artifact_size": 3072,
                "_benchmark_artifact_components": [],
                "_benchmark_workflow_sha256": "8" * 64,
            }
            with (
                patch("backend.main.ollama_payload", new=AsyncMock(return_value={"models": []})),
                patch("backend.main.whisper_service_benchmark_models", new=AsyncMock(return_value=[])),
                patch("backend.main.managed_comfyui_enabled", return_value=True),
                patch("backend.main.managed_flux_benchmark_model", return_value=None),
                patch("backend.main.managed_wan_benchmark_model", return_value=wan),
            ):
                candidates = asyncio.run(main_module.benchmark_suite_candidates())
        db.path = original_path
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["target"], "comfyui:wan2.1-t2v-1.3b")
        self.assertEqual(candidates[0]["protocol_id"], main_module.VIDEO_BENCHMARK_PROTOCOL_ID)
        self.assertEqual(candidates[0]["artifact_hash"], "7" * 64)

    def test_video_sample_is_fixed_ephemeral_and_explicitly_degraded(self) -> None:
        content = b"\x1aE\xdf\xa3" + b"webm-test-payload"
        execute = AsyncMock(return_value={
            "content_type": "video/webm",
            "data_base64": base64.b64encode(content).decode("ascii"),
        })
        case = {
            "prompt": "fixed motion",
            "seed": 42,
            "width": 832,
            "height": 480,
            "frames": 33,
            "steps": 30,
            "fps": 24,
        }
        with (
            patch("backend.main.execute_managed_comfyui", new=execute),
            patch("backend.main.shutil.which", return_value=None),
        ):
            result = asyncio.run(main_module.execute_video_benchmark_sample(
                {
                    "engine": "comfyui",
                    "endpoint_url": "http://127.0.0.1:8188",
                    "timeout_seconds": 30,
                },
                case,
            ))
        self.assertTrue(result["valid"])
        self.assertEqual(result["native"]["validation_level"], "container-signature")
        self.assertEqual(result["native"]["probe_status"], "ffprobe-unavailable")
        self.assertEqual(result["native"]["perceptual_status"], "ffmpeg-unavailable")
        self.assertIsNone(result["native"]["dimensions_match"])
        self.assertEqual(result["native"]["size_bytes"], len(content))
        self.assertEqual(len(result["output_hash"]), 64)
        self.assertEqual(execute.await_args.kwargs["seed"], 42)
        self.assertEqual(execute.await_args.kwargs["frames"], 33)
        self.assertFalse(execute.await_args.kwargs["persist_output"])

    def test_video_summary_uses_exact_and_perceptual_reproducibility(self) -> None:
        samples = [
            {
                "valid": 1,
                "total_ms": 1000,
                "native_metrics_json": main_module.canonical_json({
                    "container_integrity": True,
                    "dimensions_match": True,
                    "temporal_match": True,
                    "video_sha256": exact,
                    "perceptual_sha256": perceptual,
                    "size_bytes": 100,
                }),
            }
            for exact, perceptual in (
                ("a" * 64, "c" * 64),
                ("b" * 64, "c" * 64),
            )
        ]
        summary = main_module.video_benchmark_summary(samples)
        self.assertEqual(
            summary["video_validation"]["exact_reproducibility_percent"], 50,
        )
        self.assertEqual(
            summary["video_validation"]["perceptual_reproducibility_percent"], 100,
        )
        self.assertFalse(summary["score_provisional"])
        self.assertEqual(
            summary["score_algorithm"],
            main_module.VIDEO_BENCHMARK_SCORE_ALGORITHM,
        )

    def test_benchmark_job_persists_warmups_samples_and_score(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "runner.db"
            db.initialize()
            job_id = db.create_job("benchmark.run", "ollama:example:latest")
            run_id = "run-job-test"
            model = {
                "id": "ollama",
                "name": "example:latest",
                "engine": "ollama",
                "model_ref": "example:latest",
                "model_alias": "example:latest",
                "task": "chat",
                "input_modalities": ["text"],
                "output_modalities": ["text"],
                "context_size": 8192,
                "timeout_seconds": 30,
                "_benchmark_target": "ollama:example:latest",
                "_benchmark_context": 8192,
                "_benchmark_ollama_info": {
                    "name": "example:latest",
                    "digest": "c" * 64,
                    "size": 1024,
                },
            }

            def register_environment() -> str:
                db.execute(
                    """
                    INSERT INTO benchmark_environments(
                        id,environment_hash,hardware_json,software_json,created_at
                    ) VALUES(?,?,?,?,?)
                    """,
                    ("env-runner", "d" * 64, "{}", "{}", datetime.now(timezone.utc).isoformat()),
                )
                return "env-runner"

            sample = {
                "ttft_ms": 100,
                "total_ms": 1000,
                "prompt_tokens": 16,
                "output_tokens": 20,
                "output_tps": 20,
                "chars_per_second": 80,
                "output_chars": 80,
                "output_hash": "e" * 64,
                "native": {},
                "valid": True,
                "error": "",
            }
            with (
                patch("backend.main.resolve_benchmark_target", new=AsyncMock(return_value=model)),
                patch("backend.main.release_idle_ollama_residents", new=AsyncMock(return_value=[])),
                patch("backend.main.assert_benchmark_isolation", new=AsyncMock()),
                patch("backend.main.benchmark_runtime_busy", new=AsyncMock(return_value="")),
                patch("backend.main.benchmark_ollama_details", new=AsyncMock(return_value={})),
                patch("backend.main.register_benchmark_environment", side_effect=register_environment),
                patch("backend.main.execute_benchmark_sample", new=AsyncMock(return_value=sample)),
                patch("backend.main.collect_benchmark_telemetry", new=AsyncMock()),
            ):
                asyncio.run(main_module.run_benchmark_job(
                    job_id,
                    run_id,
                    main_module.BenchmarkRunRequest(
                        target="ollama:example:latest",
                        repetitions=1,
                    ),
                ))
            run = db.rows("SELECT * FROM benchmark_runs WHERE id=?", (run_id,))[0]
            samples = db.rows("SELECT phase FROM benchmark_samples WHERE run_id=?", (run_id,))
            job = db.rows("SELECT status FROM jobs WHERE id=?", (job_id,))[0]
            self.assertEqual(job["status"], "completed")
            self.assertEqual(run["valid"], 1)
            self.assertGreater(run["score"], 0)
            self.assertEqual(len(samples), 6)
            self.assertEqual(sum(item["phase"] == "warmup" for item in samples), 3)
        db.path = original_path

    def test_standalone_gguf_benchmark_starts_and_stops_its_own_server(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "gguf-run.db"
            db.initialize()
            job_id = db.create_job("benchmark.run", "gguf:abc")
            model = {
                "id": "gguf-abc", "name": "author/Model · Q8_0", "engine": "llama.cpp",
                "model_ref": "benchmark-gguf-abc", "model_alias": "benchmark-gguf-abc", "task": "chat",
                "port": main_module.BENCHMARK_GGUF_PORT, "context_size": 8192,
                "_benchmark_target": "gguf:abc", "_benchmark_context": 8192,
            }
            events: list[str] = []

            async def launch(profile: dict[str, Any], launched: dict[str, Any], context: int, key: str) -> None:
                events.append(f"launch {profile['id']} {context} {key}")

            async def stop(key: str) -> None:
                events.append(f"stop {key}")

            runtime = {"engine": "llama.cpp", "model_ref": "benchmark-gguf-abc"}
            with (
                patch("backend.main.resolve_benchmark_target", new=AsyncMock(return_value=model)),
                patch("backend.main.assert_benchmark_isolation", new=AsyncMock()),
                patch("backend.main.register_benchmark_model", new=AsyncMock(return_value="bm-test")),
                patch("backend.main.register_benchmark_environment", return_value="env-test"),
                patch("backend.main.benchmark_runtime_config", return_value=(runtime, "h" * 64)),
                patch("backend.main.benchmark_co_resident_models", return_value=[]),
                patch("backend.main.launch_profile_model", side_effect=launch),
                patch("backend.main.stop_model_process", side_effect=stop),
                patch("backend.main.collect_benchmark_telemetry", new=AsyncMock()),
            ):
                asyncio.run(main_module.run_benchmark_job(
                    job_id, "run-gguf", main_module.BenchmarkRunRequest(target="gguf:abc", repetitions=1),
                ))
        db.path = original_path
        key = f"benchmark-run:{job_id}"
        self.assertEqual(events, [f"launch benchmark-gguf 8192 {key}", f"stop {key}"])

    def test_benchmark_export_import_round_trip_and_checksum(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.db"
            db.path = source_path
            with TestClient(app) as client:
                self.seed_benchmark_run(db)
                bundle_response = client.get("/api/benchmarks/runs/run-test/export")
            self.assertEqual(bundle_response.status_code, 200)
            bundle = bundle_response.json()
            self.assertEqual(bundle["schema_version"], 1)

            db.path = Path(directory) / "destination.db"
            with TestClient(app) as client:
                imported = client.post("/api/benchmarks/import", json={"bundle": bundle})
                detail = client.get("/api/benchmarks/runs/run-test")
                duplicate = client.post("/api/benchmarks/import", json={"bundle": bundle})
                damaged_bundle = {**bundle, "exported_at": "changed"}
                damaged = client.post("/api/benchmarks/import", json={"bundle": damaged_bundle})
            self.assertEqual(imported.status_code, 200)
            self.assertTrue(imported.json()["imported"])
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(len(detail.json()["samples"]), 3)
            self.assertTrue(detail.json()["imported"])
            self.assertTrue(duplicate.json()["duplicate"])
            self.assertEqual(damaged.status_code, 400)
        db.path = original_path

    def insert_sample(self, run_id: str, case_id: str, repetition: int, tps: float) -> None:
        db.execute(
            """
            INSERT INTO benchmark_samples(
                run_id,case_id,phase,repetition,started_at,ttft_ms,total_ms,
                prompt_tokens,output_tokens,output_tps,chars_per_second,
                output_chars,output_hash,native_metrics_json,valid,error
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id, case_id, "measured", repetition,
                datetime.now(timezone.utc).isoformat(), 100, 1000, 16, 20, tps, 80,
                80, "f" * 64, '{"early_stop": true}', 1, "",
            ),
        )

    def test_benchmark_stability_is_measured_within_each_case(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "stability.db"
            db.initialize()
            self.seed_benchmark_run(db)
            db.execute("DELETE FROM benchmark_samples WHERE run_id='run-test'")
            for repetition in (1, 2):
                self.insert_sample("run-test", "interactive", repetition, 10)
                self.insert_sample("run-test", "throughput", repetition, 50)
            summary = main_module.benchmark_summary("run-test")
        db.path = original_path
        self.assertEqual(summary["output_tokens_per_second"]["coefficient_of_variation"], 0)
        self.assertEqual(summary["score_dimensions"]["stability"], 100)
        self.assertFalse(summary["score_provisional"])
        self.assertEqual(summary["cases"]["throughput"]["output_tokens_per_second_mean"], 50)
        self.assertEqual(summary["cases"]["interactive"]["early_stops"], 2)

    def test_single_repetition_score_is_provisional_and_renormalized(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "provisional.db"
            db.initialize()
            self.seed_benchmark_run(db)
            db.execute("DELETE FROM benchmark_samples WHERE run_id='run-test'")
            self.insert_sample("run-test", "interactive", 1, 100)
            summary = main_module.benchmark_summary("run-test")
        db.path = original_path
        self.assertTrue(summary["score_provisional"])
        self.assertIsNone(summary["score_dimensions"]["stability"])
        dimensions = summary["score_dimensions"]
        expected = (
            dimensions["throughput"] * 0.35
            + dimensions["latency"] * 0.30
            + dimensions["reliability"] * 0.15
        ) / 0.80
        self.assertAlmostEqual(summary["score"], expected, delta=0.2)

    def test_openai_stream_separates_reasoning_and_records_finish_reason(self) -> None:
        events = [
            {"choices": [{"delta": {"reasoning_content": "pienso"}}]},
            {"choices": [{"delta": {"content": "hola"}}]},
            {"choices": [{"delta": {}, "finish_reason": "length"}]},
            {"choices": [], "usage": {"prompt_tokens": 4, "completion_tokens": 16}},
        ]

        class FakeResponse:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                for event in events:
                    yield f"data: {json.dumps(event)}"
                yield "data: [DONE]"

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def stream(self, *_args, **_kwargs):
                return FakeResponse()

        with patch("backend.main.httpx.AsyncClient", return_value=FakeClient()):
            result = asyncio.run(main_module.execute_benchmark_sample(
                {"engine": "llama.cpp", "port": 18080, "model_ref": "x", "timeout_seconds": 30},
                {"prompt": "test", "max_tokens": 16},
            ))
        self.assertTrue(result["valid"])
        self.assertEqual(result["native"]["finish_reason"], "length")
        self.assertEqual(result["native"]["reasoning_chars"], 6)
        self.assertTrue(result["native"]["hit_token_limit"])
        self.assertFalse(result["native"]["early_stop"])
        self.assertIsNotNone(result["native"]["visible_ttft_ms"])
        self.assertEqual(result["output_chars"], 4)

    def test_automatic_queue_waits_for_idle_window_and_retries(self) -> None:
        original_path = db.path
        original_auto = main_module.settings.benchmark_auto_new_models
        main_module.settings.benchmark_auto_new_models = True
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "queue.db"
                db.initialize()
                self.assertTrue(main_module.enqueue_automatic_benchmark("ollama:example", "test"))
                self.assertFalse(
                    main_module.enqueue_automatic_benchmark("ollama:example:latest", "test")
                )
                with patch(
                    "backend.main.benchmark_preflight_reason",
                    new=AsyncMock(return_value="Periodo de calma tras uso interactivo (40 s)"),
                ):
                    self.assertIsNone(asyncio.run(main_module.process_benchmark_queue_once()))
                entry = db.rows("SELECT * FROM benchmark_queue")[0]
                self.assertEqual(entry["status"], "pending")
                self.assertIn("calma", entry["last_reason"])

                runner = AsyncMock(side_effect=["retry", "completed"])
                with (
                    patch("backend.main.benchmark_preflight_reason", new=AsyncMock(return_value="")),
                    patch("backend.main.resolve_benchmark_target", new=AsyncMock(return_value={})),
                    patch("backend.main.run_benchmark_job", new=runner),
                ):
                    asyncio.run(main_module.process_benchmark_queue_once())
                    retry_entry = db.rows("SELECT * FROM benchmark_queue")[0]
                    asyncio.run(main_module.process_benchmark_queue_once())
                done_entry = db.rows("SELECT * FROM benchmark_queue")[0]
                self.assertEqual(retry_entry["status"], "pending")
                self.assertEqual(retry_entry["attempts"], 1)
                self.assertEqual(done_entry["status"], "done")
                self.assertTrue(runner.await_args.kwargs["automatic"])
                self.assertEqual(runner.await_args.args[2].target, "ollama:example:latest")

                self.assertTrue(main_module.enqueue_automatic_benchmark("ollama:measured", "profile.loaded"))
                jobs_before = len(db.rows("SELECT id FROM jobs"))
                skipped_runner = AsyncMock(return_value="completed")
                with (
                    patch("backend.main.benchmark_preflight_reason", new=AsyncMock(return_value="")),
                    patch("backend.main.resolve_benchmark_target", new=AsyncMock(return_value={"task": "chat"})),
                    patch("backend.main.automatic_benchmark_duplicate", new=AsyncMock(return_value="run-1")),
                    patch("backend.main.run_benchmark_job", new=skipped_runner),
                ):
                    self.assertIsNone(asyncio.run(main_module.process_benchmark_queue_once()))
                measured = db.rows("SELECT * FROM benchmark_queue WHERE target='ollama:measured:latest'")[0]
                self.assertEqual((measured["status"], measured["last_reason"]), ("done", "duplicate"))
                self.assertEqual(len(db.rows("SELECT id FROM jobs")), jobs_before)
                skipped_runner.assert_not_awaited()
        finally:
            main_module.settings.benchmark_auto_new_models = original_auto
            db.path = original_path

    def test_profile_load_queues_text_and_local_semantic_models(self) -> None:
        original_path = db.path
        original_auto = main_module.settings.benchmark_auto_new_models
        main_module.settings.benchmark_auto_new_models = True
        models = [
            {"id": "primary", "engine": "llama.cpp", "task": "chat", "model_ref": "a"},
            {
                "id": "embed", "engine": "llama.cpp", "task": "embeddings",
                "model_ref": "b", "port": 8081,
            },
            {"id": "remote", "engine": "ollama", "task": "chat", "model_ref": "qwen3"},
        ]
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "profile-queue.db"
                db.initialize()
                with patch("backend.main.running_profile_models", return_value=models):
                    queued = main_module.queue_profile_benchmarks({"id": "p1"})
                targets = {row["target"] for row in db.rows("SELECT target FROM benchmark_queue")}
        finally:
            main_module.settings.benchmark_auto_new_models = original_auto
            db.path = original_path
        self.assertEqual(queued, 3)
        self.assertEqual(
            targets,
            {"profile:p1:primary", "profile:p1:embed", "ollama:qwen3:latest"},
        )

    def test_automatic_benchmark_skips_equivalent_valid_run(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "duplicate.db"
            db.initialize()
            self.seed_benchmark_run(db)
            runtime = {"engine": "ollama", "model_ref": "example:latest"}
            job_id = db.create_job("benchmark.run", "ollama:example:latest")
            with (
                patch("backend.main.resolve_benchmark_target", new=AsyncMock(return_value={
                    "engine": "ollama", "model_ref": "example:latest", "task": "chat",
                })),
                patch("backend.main.release_idle_ollama_residents", new=AsyncMock(return_value=[])),
                patch("backend.main.assert_benchmark_isolation", new=AsyncMock()),
                patch("backend.main.register_benchmark_model", new=AsyncMock(return_value="bm-test")),
                patch("backend.main.register_benchmark_environment", return_value="env-test"),
                patch(
                    "backend.main.benchmark_runtime_config",
                    return_value=(runtime, main_module.content_hash(runtime)),
                ),
                patch("backend.main.execute_benchmark_sample", new=AsyncMock()) as sample,
            ):
                outcome = asyncio.run(main_module.run_benchmark_job(
                    job_id,
                    "run-duplicate",
                    main_module.BenchmarkRunRequest(target="ollama:example:latest"),
                    automatic=True,
                ))
            job = db.rows("SELECT status FROM jobs WHERE id=?", (job_id,))[0]
            gate = main_module.benchmark_gate_active()
        db.path = original_path
        self.assertEqual(outcome, "duplicate")
        self.assertEqual(job["status"], "completed")
        sample.assert_not_awaited()
        self.assertFalse(gate)

    def test_benchmark_gate_pauses_interactive_and_gateway_inference(self) -> None:
        from backend import gateway

        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "gate.db"
            db.initialize()
            main_module.set_benchmark_gate("job-gate", 60)
            with self.assertRaises(HTTPException) as raised:
                main_module.ensure_interactive_inference_available()
            paused = gateway.benchmark_pause_response()
            anthropic = gateway.benchmark_pause_response(True)
            main_module.set_benchmark_gate(None)
            released = gateway.benchmark_pause_response()
        db.path = original_path
        self.assertEqual(raised.exception.status_code, 423)
        self.assertEqual(paused.status_code, 503)
        self.assertEqual(paused.headers["retry-after"], "30")
        self.assertIn(b"benchmark_in_progress", paused.body)
        self.assertEqual(anthropic.status_code, 503)
        self.assertIsNone(released)

    def test_gateway_inference_delays_benchmarks_across_processes(self) -> None:
        from backend import gateway

        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "activity.db"
            db.initialize()
            with (
                patch("backend.gateway.mark_gateway_inference", main_module.mark_gateway_inference),
                patch.object(main_module, "_last_interactive_inference_at", 0.0),
                patch.object(main_module, "_last_gateway_activity_write", float("-inf")),
                patch("backend.main.benchmark_runtime_busy", new=AsyncMock(return_value="")),
            ):
                idle = asyncio.run(main_module.benchmark_preflight_reason("ollama:x:latest"))
                self.assertIsNone(gateway.benchmark_pause_response())
                stored = main_module.preference_value(main_module.GATEWAY_ACTIVITY_KEY)
                busy = asyncio.run(main_module.benchmark_preflight_reason("ollama:x:latest"))
                main_module.db.execute(
                    "UPDATE preferences SET value=? WHERE key=?",
                    (str(time.time() - settings.benchmark_quiet_seconds - 1),
                     main_module.GATEWAY_ACTIVITY_KEY),
                )
                expired = asyncio.run(main_module.benchmark_preflight_reason("ollama:x:latest"))
        db.path = original_path
        self.assertEqual(idle, "")
        self.assertIsNotNone(stored)
        self.assertIn("Periodo de calma", busy)
        self.assertEqual(expired, "")

    def test_runtime_hash_ignores_isolation_metadata(self) -> None:
        runtime = {"engine": "llama.cpp", "args": ["-c", "8192"]}
        with_isolation = {**runtime, "isolation": {"co_resident_models": ["x"]}}
        self.assertEqual(
            main_module.benchmark_runtime_hash(runtime),
            main_module.benchmark_runtime_hash(with_isolation),
        )

    def seed_benchmark_suite(
        self,
        database: Database,
        *,
        cancelled: bool = False,
    ) -> tuple[str, str]:
        suite_id = "suite-test"
        job_id = database.create_job("benchmark.suite", "1 modelos")
        if cancelled:
            database.request_job_cancel(job_id)
        now = datetime.now(timezone.utc).isoformat()
        database.execute(
            """
            INSERT INTO benchmark_suites(
                id,job_id,status,repetitions,total_models,snapshot_json,created_at
            ) VALUES(?,?,'queued',3,1,?,?)
            """,
            (
                suite_id,
                job_id,
                main_module.canonical_json({
                    "profile_ids": ["profile-before"],
                    "ollama_residents": ["assistant:latest"],
                }),
                now,
            ),
        )
        database.execute(
            """
            INSERT INTO benchmark_suite_items(
                suite_id,position,candidate_key,target,model_name,engine,
                artifact_hash,artifact_size,profile_id,model_id,status
            ) VALUES(?,1,?,?,?,?,?,?,?,?,'pending')
            """,
            (
                suite_id,
                "ollama:" + "a" * 64,
                "ollama:example:latest",
                "Example",
                "ollama",
                "a" * 64,
                1024,
                "",
                "ollama",
            ),
        )
        return suite_id, job_id

    def test_suite_candidates_exclude_artifact_completed_by_previous_suite(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-candidates.db"
            db.initialize()
            digest = "b" * 64
            tags = {"models": [
                {"name": "measured:latest", "digest": digest, "size": 1000},
                {"name": "pending:latest", "digest": "c" * 64, "size": 2000},
            ]}
            db.execute(
                """
                INSERT INTO benchmark_models(
                    id,source,source_id,revision,filename,artifact_hash,artifact_size,
                    quantization,architecture,metadata_json,card_text,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    "bm-measured", "ollama", "measured:latest", "", "", digest,
                    1000, "", "", "{}", "", datetime.now(timezone.utc).isoformat(),
                ),
            )
            database_job = db.create_job("benchmark.run", "ollama:measured:latest")
            db.execute(
                """
                INSERT INTO benchmark_environments(
                    id,environment_hash,hardware_json,software_json,created_at
                ) VALUES(?,?,?,?,?)
                """,
                ("env-suite", "d" * 64, "{}", "{}", datetime.now(timezone.utc).isoformat()),
            )
            db.execute(
                """
                INSERT INTO benchmark_runs(
                    id,job_id,protocol_id,model_id,environment_id,target,runtime_hash,
                    runtime_json,score_algorithm,status,valid,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,'completed',1,?)
                """,
                (
                    "run-measured", database_job, main_module.BENCHMARK_PROTOCOL_ID,
                    "bm-measured", "env-suite", "ollama:measured:latest", "e" * 64,
                    "{}", main_module.BENCHMARK_SCORE_ALGORITHM,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            suite_job = db.create_job("benchmark.suite", "mydgx-text-generation-v1")
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                """
                INSERT INTO benchmark_suites(
                    id,job_id,status,repetitions,total_models,completed_models,
                    snapshot_json,created_at,completed_at
                ) VALUES(?,?,'completed',3,1,1,'{}',?,?)
                """,
                ("suite-completed", suite_job, now, now),
            )
            db.execute(
                """
                INSERT INTO benchmark_suite_items(
                    suite_id,position,candidate_key,target,model_name,engine,
                    artifact_hash,artifact_size,profile_id,model_id,status,completed_at
                ) VALUES(?,1,?,?,?,?,?,?,?,?,'completed',?)
                """,
                (
                    "suite-completed", f"ollama:{digest}", "ollama:measured:latest",
                    "measured:latest", "ollama", digest, 1000, "", "ollama", now,
                ),
            )
            with (
                patch("backend.main.ollama_payload", new=AsyncMock(return_value=tags)),
                patch("backend.main.profile_model_is_downloaded", return_value=False),
            ):
                candidates = asyncio.run(main_module.benchmark_suite_candidates())
                all_candidates = asyncio.run(
                    main_module.benchmark_suite_candidates(include_measured=True)
                )
        db.path = original_path
        self.assertEqual([item["name"] for item in candidates], ["pending:latest"])
        self.assertEqual(
            {item["name"] for item in all_candidates},
            {"measured:latest", "pending:latest"},
        )

    def test_benchmark_suite_runs_items_and_restores_snapshot(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-runner.db"
            db.initialize()
            suite_id, job_id = self.seed_benchmark_suite(db)
            restore = AsyncMock(return_value=[])
            with (
                patch("backend.main.stop_profile_process", new=AsyncMock()),
                patch("backend.main.release_all_ollama_models", new=AsyncMock(return_value=[])),
                patch("backend.main.wait_for_memory_recovery", new=AsyncMock()),
                patch(
                    "backend.main.load_benchmark_suite_item",
                    new=AsyncMock(return_value="ollama:example:latest"),
                ),
                patch("backend.main.run_benchmark_job", new=AsyncMock(return_value="completed")) as run,
                patch("backend.main.restore_benchmark_suite_snapshot", new=restore),
            ):
                asyncio.run(main_module.run_benchmark_suite(suite_id, job_id))
            suite = db.rows("SELECT * FROM benchmark_suites WHERE id=?", (suite_id,))[0]
            item = db.rows("SELECT * FROM benchmark_suite_items WHERE suite_id=?", (suite_id,))[0]
            job = db.rows("SELECT * FROM jobs WHERE id=?", (job_id,))[0]
        db.path = original_path
        self.assertEqual(suite["status"], "completed")
        self.assertEqual(suite["completed_models"], 1)
        self.assertEqual(item["status"], "completed")
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["progress"], 100)
        self.assertEqual(run.await_args.kwargs["parent_job_id"], job_id)
        self.assertEqual(run.await_args.kwargs["suite_progress"], (1, 1))
        restore.assert_awaited_once_with({
            "profile_ids": ["profile-before"],
            "ollama_residents": ["assistant:latest"],
        })

    def test_benchmark_suite_skips_unavailable_external_runtime_and_continues(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-skip.db"
            db.initialize()
            suite_id, job_id = self.seed_benchmark_suite(db)
            with (
                patch("backend.main.stop_profile_process", new=AsyncMock()),
                patch("backend.main.release_all_ollama_models", new=AsyncMock(return_value=[])),
                patch("backend.main.release_whisper_models", new=AsyncMock()),
                patch("backend.main.release_comfyui_models", new=AsyncMock()),
                patch("backend.main.wait_for_memory_recovery", new=AsyncMock()),
                patch(
                    "backend.main.load_benchmark_suite_item",
                    new=AsyncMock(side_effect=main_module.ExternalRuntimeUnavailable(
                        "El endpoint de TTS no está disponible"
                    )),
                ),
                patch("backend.main.run_benchmark_job", new=AsyncMock()) as run,
                patch(
                    "backend.main.restore_benchmark_suite_snapshot",
                    new=AsyncMock(return_value=[]),
                ),
            ):
                asyncio.run(main_module.run_benchmark_suite(suite_id, job_id))
            suite = db.rows("SELECT * FROM benchmark_suites WHERE id=?", (suite_id,))[0]
            item = db.rows("SELECT * FROM benchmark_suite_items WHERE suite_id=?", (suite_id,))[0]
        db.path = original_path
        run.assert_not_awaited()
        self.assertEqual(suite["status"], "completed")
        self.assertEqual(item["status"], "skipped")
        self.assertIn("no está disponible", item["error"])

    def test_suite_lists_external_tts_and_blocks_it_while_runtime_is_down(self) -> None:
        original_path = db.path
        payload = {
            "name": "Marcos voz",
            "engine": "openai-compatible",
            "model_ref": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
            "model_alias": "tts-marcos",
            "port": 18010,
            "task": "tts",
            "input_modalities": ["text"],
            "output_modalities": ["audio"],
            "runtime_backend": "external",
            "endpoint_url": "http://127.0.0.1:8010/api/projects/marcos-voz",
            "api_protocol": "tts-lab",
            "runtime_requirement": "tts-lab + MLX",
        }
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-external.db"
            try:
                down, up, status_code = self.external_tts_inventory(payload)
            finally:
                db.path = original_path
        tts = [item for item in down if item.get("variant") == "Marcos voz"]
        self.assertGreaterEqual(len(tts), 1)
        self.assertEqual(tts[0]["protocol_id"], main_module.TTS_BENCHMARK_PROTOCOL_ID)
        self.assertEqual(tts[0]["name"], "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")
        self.assertEqual(tts[0]["artifact_size"], 4096)
        self.assertFalse(tts[0]["runnable"])
        self.assertIn("127.0.0.1:8010", tts[0]["blocked_reason"])
        self.assertTrue(next(item for item in up if item.get("variant") == "Marcos voz")["runnable"])
        self.assertEqual(status_code, 409)

    def test_suite_discovers_downloaded_gguf_without_profile_and_launches_it(self) -> None:
        original_path, original_hf = db.path, settings.hf_home
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-gguf.db"
            settings.hf_home = directory
            root = Path(directory) / "hub" / "models--org--Demo-GGUF"
            blobs, snapshot = root / "blobs", root / "snapshots" / "abc"
            blobs.mkdir(parents=True)
            snapshot.mkdir(parents=True)
            (root / "refs").mkdir()
            (root / "refs" / "main").write_text("abc")
            files = {
                "Q8_0/Demo-Q8_0-00001-of-00002.gguf": b"a" * 10,
                "Q8_0/Demo-Q8_0-00002-of-00002.gguf": b"b" * 10,
                "BF16/Demo-BF16-00001-of-00002.gguf": b"c" * 10,
                "Demo-Q4_K_M.gguf": b"d" * 7,
                "mmproj-F16.gguf": b"e" * 3,
                "MTP/mtp-Demo-Q4_K_M.gguf": b"f" * 2,
                "dspark-Demo-Q8_0.gguf": b"g" * 2,
            }
            for index, (name, content) in enumerate(files.items()):
                blob = blobs / f"blob{index}"
                blob.write_bytes(content)
                (snapshot / name).parent.mkdir(parents=True, exist_ok=True)
                (snapshot / name).symlink_to(blob)
            try:
                db.initialize()
                with (
                    patch("backend.main.ollama_payload", new=AsyncMock(return_value={"models": []})),
                    patch(
                        "backend.main.whisper_service_benchmark_models",
                        new=AsyncMock(return_value=[]),
                    ),
                    patch("backend.main.managed_comfyui_enabled", return_value=False),
                    patch("backend.main.external_endpoint_reachable", new=AsyncMock(return_value=False)),
                ):
                    candidates = asyncio.run(main_module.benchmark_suite_candidates())
                gguf = [item for item in candidates if item["target"].startswith("gguf:")]
                with patch("backend.main.launch_profile_model", new=AsyncMock()) as launch:
                    target = asyncio.run(main_module.load_benchmark_suite_item({
                        "engine": "llama.cpp",
                        "profile_id": "",
                        "model_id": gguf[0]["model_id"],
                        "target": gguf[0]["target"],
                        "suite_id": "suite-1",
                        "position": 1,
                    }))
            finally:
                db.path, settings.hf_home = original_path, original_hf
        self.assertEqual(
            sorted((item["artifact_size"], item["variant"]) for item in gguf),
            [(7, "Q4_K_M"), (20, "Q8_0 · 2 shards")],
        )
        self.assertTrue(all(item["name"] == "org/Demo-GGUF" and item["runnable"] for item in gguf))
        self.assertEqual(target, gguf[0]["target"])
        profile, model, context, runtime_key = launch.await_args.args
        self.assertEqual(profile["id"], "benchmark-gguf")
        self.assertEqual(model["engine"], "llama.cpp")
        self.assertEqual(model["port"], main_module.BENCHMARK_GGUF_PORT)
        self.assertEqual(context, 8192)
        self.assertEqual(runtime_key, "benchmark-suite:suite-1:1")
        self.assertNotIn("mmproj", " ".join(model["model_files"]))

    def seed_hf_repo(self, hub: Path, repo: str, files: dict[str, bytes]) -> None:
        root = hub / f"models--{repo.replace('/', '--')}"
        snapshot = root / "snapshots" / "rev1"
        (root / "blobs").mkdir(parents=True)
        snapshot.mkdir(parents=True)
        (root / "refs").mkdir()
        (root / "refs" / "main").write_text("rev1")
        for index, (name, content) in enumerate(files.items()):
            blob = root / "blobs" / f"blob{index}"
            blob.write_bytes(content)
            (snapshot / name).parent.mkdir(parents=True, exist_ok=True)
            (snapshot / name).symlink_to(blob)

    def test_managed_tts_inventory_marks_engines_that_are_not_installed(self) -> None:
        original_hf = settings.hf_home
        with tempfile.TemporaryDirectory() as directory:
            settings.hf_home = directory
            hub = Path(directory) / "hub"
            self.seed_hf_repo(hub, "Qwen/Qwen3-TTS-12Hz-1.7B-Base", {"model.safetensors": b"q" * 40})
            self.seed_hf_repo(hub, "fishaudio/s2-pro", {"model.pth": b"f" * 30})
            self.seed_hf_repo(hub, "SWivid/F5-TTS", {"F5TTS_v1_Base/model_1250000.safetensors": b"5" * 9})
            self.seed_hf_repo(hub, "mlx-community/unrelated", {"weights.npz": b"m" * 5})
            healthy = {"engines": {"qwen3": True, "fish": False, "f5": True}}
            try:
                with patch("backend.main.managed_tts_health", new=AsyncMock(return_value=healthy)):
                    models = asyncio.run(main_module.managed_tts_benchmark_models())
                    self.seed_hf_repo(hub, "charactr/vocos-mel-24khz", {"pytorch_model.bin": b"v" * 3})
                    with_vocoder = asyncio.run(main_module.managed_tts_benchmark_models())
                with patch("backend.main.managed_tts_health", new=AsyncMock(return_value=None)):
                    offline = asyncio.run(main_module.managed_tts_benchmark_models())
            finally:
                settings.hf_home = original_hf
        by_repo = {model["model_ref"]: model for model in models}
        self.assertEqual(set(by_repo), {"Qwen/Qwen3-TTS-12Hz-1.7B-Base", "fishaudio/s2-pro", "SWivid/F5-TTS"})
        self.assertEqual(by_repo["Qwen/Qwen3-TTS-12Hz-1.7B-Base"]["_benchmark_blocked_reason"], "")
        self.assertEqual(by_repo["Qwen/Qwen3-TTS-12Hz-1.7B-Base"]["_benchmark_artifact_size"], 40)
        self.assertIn("fish", by_repo["fishaudio/s2-pro"]["_benchmark_blocked_reason"])
        self.assertIn("charactr/vocos-mel-24khz", by_repo["SWivid/F5-TTS"]["_benchmark_blocked_reason"])
        f5_ready = next(model for model in with_vocoder if model["model_ref"] == "SWivid/F5-TTS")
        self.assertEqual(f5_ready["_benchmark_blocked_reason"], "")
        self.assertTrue(all("no activo" in model["_benchmark_blocked_reason"] for model in offline))

    def test_suite_item_loads_managed_tts_and_runtime_down_is_skippable(self) -> None:
        original_hf = settings.hf_home
        with tempfile.TemporaryDirectory() as directory:
            settings.hf_home = directory
            self.seed_hf_repo(Path(directory) / "hub", "k2-fsa/OmniVoice", {"model.safetensors": b"o" * 8})
            item = {
                "engine": "mydgx-tts", "profile_id": "", "model_id": "k2-fsa/OmniVoice",
                "target": "tts:k2-fsa/OmniVoice", "suite_id": "suite-1", "position": 1,
            }
            try:
                with patch("backend.main.load_managed_tts_model", new=AsyncMock()) as load:
                    target = asyncio.run(main_module.load_benchmark_suite_item(item))
                model = asyncio.run(main_module.resolve_benchmark_target("tts:k2-fsa/OmniVoice"))
            finally:
                settings.hf_home = original_hf
        load.assert_awaited_once_with("k2-fsa/OmniVoice")
        self.assertEqual(target, "tts:k2-fsa/OmniVoice")
        self.assertEqual(model["task"], "tts")
        self.assertEqual(model["api_protocol"], "mydgx-tts")
        self.assertTrue(issubclass(main_module.ManagedTtsUnavailable, main_module.ExternalRuntimeUnavailable))

    def test_managed_tts_sample_posts_speech_and_measures_wav(self) -> None:
        import io
        import wave

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(24_000)
            handle.writeframes(b"".join(
                struct.pack("<h", int(8000 * math.sin(index / 10))) for index in range(24_000)
            ))
        requests: list[dict[str, Any]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append({"url": str(request.url), "json": json.loads(request.content)})
            return httpx.Response(200, content=buffer.getvalue(), headers={"content-type": "audio/wav"})

        real_client = httpx.AsyncClient
        model = {
            "engine": "mydgx-tts", "api_protocol": "mydgx-tts", "model_ref": "k2-fsa/OmniVoice",
            "model_alias": "k2-fsa/OmniVoice", "endpoint_url": "http://127.0.0.1:9010",
            "timeout_seconds": 30, "task": "tts",
        }
        case = {"text": "The quick brown fox.", "language": "en"}
        with (
            patch(
                "backend.main.httpx.AsyncClient",
                side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
            ),
            patch(
                "backend.main.tts_roundtrip_asr",
                new=AsyncMock(return_value={
                    "intelligibility_available": False,
                    "intelligibility_status": "local-whisper-unavailable",
                    "wer": None, "cer": None,
                }),
            ),
        ):
            sample = asyncio.run(main_module.execute_tts_benchmark_sample(model, case))
        self.assertEqual(requests[0]["url"], "http://127.0.0.1:9010/v1/audio/speech")
        self.assertEqual(requests[0]["json"]["model"], "k2-fsa/OmniVoice")
        self.assertEqual(requests[0]["json"]["language"], "en")
        self.assertTrue(sample["valid"])
        self.assertAlmostEqual(sample["native"]["duration_seconds"], 1.0, places=2)

    def test_gguf_larger_than_memory_is_listed_but_blocked(self) -> None:
        with patch("backend.main.psutil.virtual_memory", return_value=SimpleNamespace(total=128 * 1024**3)):
            self.assertEqual(main_module.gguf_memory_block_reason(60 * 1024**3), "")
            self.assertIn("No cabe en memoria", main_module.gguf_memory_block_reason(200 * 1024**3))

    def external_tts_inventory(
        self,
        payload: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/profiles", json=payload).status_code, 200)

        def inventory(reachable: bool) -> list[dict[str, Any]]:
            with (
                patch("backend.main.ollama_payload", new=AsyncMock(return_value={"models": []})),
                patch("backend.main.profile_model_is_downloaded", return_value=True),
                patch(
                    "backend.main.benchmark_hf_local_artifact",
                    return_value={"size": 4096, "digest": ""},
                ),
                patch("backend.main.local_hf_models", return_value=[]),
                patch(
                    "backend.main.external_endpoint_reachable",
                    new=AsyncMock(return_value=reachable),
                ),
                patch(
                    "backend.main.whisper_service_benchmark_models",
                    new=AsyncMock(return_value=[]),
                ),
                patch("backend.main.managed_comfyui_enabled", return_value=False),
            ):
                return asyncio.run(main_module.benchmark_suite_candidates(include_measured=True))

        down = inventory(False)
        up = inventory(True)
        tts_key = next(
            item["candidate_key"] for item in down if item.get("variant") == "Marcos voz"
        )

        async def start_blocked() -> None:
            with (
                patch(
                    "backend.main.benchmark_suite_candidates",
                    new=AsyncMock(return_value=down),
                ),
                patch("backend.main.benchmark_runtime_busy", new=AsyncMock(return_value="")),
                patch("backend.main.run_benchmark_suite", new=AsyncMock()),
            ):
                await main_module.start_benchmark_suite(
                    main_module.BenchmarkSuiteRequest(repetitions=1, candidate_keys=[tts_key])
                )

        with self.assertRaises(HTTPException) as blocked:
            asyncio.run(start_blocked())
        return down, up, blocked.exception.status_code

    def test_managed_comfyui_models_are_read_from_installed_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "ComfyUI" / "models" / "checkpoints" / "flux1-schnell-fp8.safetensors"
            checkpoint.parent.mkdir(parents=True)
            checkpoint.write_bytes(b"flux-weights")
            with patch("backend.main.managed_comfyui_root", return_value=root):
                self.assertEqual(main_module.managed_comfyui_source(), root / "ComfyUI")
                flux = main_module.managed_flux_benchmark_model()
        self.assertIsNotNone(flux)
        self.assertEqual(flux["_benchmark_artifact_size"], len(b"flux-weights"))

    def test_cancelled_benchmark_suite_restores_without_running_model(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-cancel.db"
            db.initialize()
            suite_id, job_id = self.seed_benchmark_suite(db, cancelled=True)
            restore = AsyncMock(return_value=[])
            load = AsyncMock()
            with (
                patch("backend.main.stop_profile_process", new=AsyncMock()),
                patch("backend.main.release_all_ollama_models", new=AsyncMock(return_value=[])),
                patch("backend.main.wait_for_memory_recovery", new=AsyncMock()),
                patch("backend.main.load_benchmark_suite_item", new=load),
                patch("backend.main.restore_benchmark_suite_snapshot", new=restore),
            ):
                asyncio.run(main_module.run_benchmark_suite(suite_id, job_id))
            suite = db.rows("SELECT status FROM benchmark_suites WHERE id=?", (suite_id,))[0]
            job = db.rows("SELECT status FROM jobs WHERE id=?", (job_id,))[0]
        db.path = original_path
        self.assertEqual(suite["status"], "cancelled")
        self.assertEqual(job["status"], "cancelled")
        load.assert_not_awaited()
        restore.assert_awaited_once()

    def test_start_benchmark_suite_persists_snapshot_and_inventory(self) -> None:
        original_path = db.path
        candidate = {
            "candidate_key": "ollama:" + "f" * 64,
            "target": "ollama:pending:latest",
            "name": "Pending",
            "engine": "ollama",
            "source": "ollama",
            "artifact_hash": "f" * 64,
            "artifact_size": 2048,
            "profile_id": "",
            "model_id": "ollama",
            "measured": False,
        }

        async def scenario() -> dict[str, str]:
            with (
                patch(
                    "backend.main.benchmark_suite_candidates",
                    new=AsyncMock(return_value=[candidate]),
                ),
                patch("backend.main.benchmark_runtime_busy", new=AsyncMock(return_value="")),
                patch(
                    "backend.main.benchmark_ollama_residents",
                    new=AsyncMock(return_value={"assistant:latest"}),
                ),
                patch("backend.main.run_benchmark_suite", new=AsyncMock()) as runner,
                patch.object(main_module, "_runtime_profile_ids", ["profile-before"]),
            ):
                result = await main_module.start_benchmark_suite(
                    main_module.BenchmarkSuiteRequest(repetitions=2)
                )
                await asyncio.sleep(0)
                runner.assert_awaited_once()
                return result

        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-start.db"
            db.initialize()
            result = asyncio.run(scenario())
            suite = db.rows("SELECT * FROM benchmark_suites WHERE id=?", (result["suite_id"],))[0]
            items = db.rows(
                "SELECT * FROM benchmark_suite_items WHERE suite_id=?",
                (result["suite_id"],),
            )
        db.path = original_path
        snapshot = json.loads(suite["snapshot_json"])
        self.assertEqual(suite["repetitions"], 2)
        self.assertEqual(suite["total_models"], 1)
        self.assertEqual(snapshot["profile_ids"], ["profile-before"])
        self.assertEqual(snapshot["ollama_residents"], ["assistant:latest"])
        self.assertEqual(items[0]["artifact_size"], 2048)

    def test_start_benchmark_suite_uses_selected_candidates_only(self) -> None:
        original_path = db.path
        candidates = [
            {
                "candidate_key": f"ollama:{letter * 64}",
                "target": f"ollama:model-{letter}:latest",
                "name": f"Model {letter.upper()}",
                "engine": "ollama",
                "protocol_id": main_module.BENCHMARK_PROTOCOL_ID,
                "modality": "text-generation",
                "artifact_hash": letter * 64,
                "artifact_size": size,
                "profile_id": "",
                "model_id": "ollama",
                "measured": False,
            }
            for letter, size in (("a", 1024), ("b", 2048))
        ]

        async def scenario() -> dict[str, str]:
            with (
                patch(
                    "backend.main.benchmark_suite_candidates",
                    new=AsyncMock(return_value=candidates),
                ),
                patch("backend.main.benchmark_runtime_busy", new=AsyncMock(return_value="")),
                patch("backend.main.benchmark_ollama_residents", new=AsyncMock(return_value=set())),
                patch("backend.main.whisper_runtime_snapshot", new=AsyncMock(return_value={})),
                patch("backend.main.run_benchmark_suite", new=AsyncMock()),
            ):
                result = await main_module.start_benchmark_suite(
                    main_module.BenchmarkSuiteRequest(
                        repetitions=1,
                        candidate_keys=[candidates[1]["candidate_key"]],
                    )
                )
                await asyncio.sleep(0)
                return result

        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "suite-selection.db"
            db.initialize()
            result = asyncio.run(scenario())
            suite = db.rows(
                "SELECT * FROM benchmark_suites WHERE id=?",
                (result["suite_id"],),
            )[0]
            items = db.rows(
                "SELECT * FROM benchmark_suite_items WHERE suite_id=?",
                (result["suite_id"],),
            )
        db.path = original_path
        self.assertEqual(suite["total_models"], 1)
        self.assertEqual(items[0]["candidate_key"], candidates[1]["candidate_key"])


class ProfileApiTests(unittest.TestCase):
    def test_only_optional_engines_can_be_started_and_stopped(self) -> None:
        state = {
            "id": "comfyui",
            "name": "ComfyUI",
            "installed": True,
            "reachable": False,
            "running": False,
            "managed": True,
            "controllable": True,
            "essential": False,
            "capabilities": [],
            "models": [],
        }
        with (
            patch(
                "backend.main.run_command",
                return_value=SimpleNamespace(returncode=0, stdout="ok", stderr=""),
            ) as command,
            patch(
                "backend.main.discover_serving_engines",
                new=AsyncMock(return_value=[state]),
            ),
            patch("backend.main.profiles_using_engine", return_value=[]),
            TestClient(app) as client,
        ):
            stopped = client.post(
                "/api/engines/comfyui/action",
                json={"action": "stop", "confirm": "stop comfyui"},
            )
            protected = client.post(
                "/api/engines/ollama/action",
                json={"action": "stop", "confirm": "stop ollama"},
            )
        self.assertEqual(stopped.status_code, 200)
        self.assertEqual(protected.status_code, 400)
        self.assertEqual(
            command.call_args.args[0][-3:],
            ["engine", "comfyui", "stop"],
        )

    def test_searxng_can_be_disabled_and_reenabled_from_engines(self) -> None:
        state = {"id": "searxng", "name": "SearXNG", "installed": True, "running": True}
        with (
            patch(
                "backend.main.run_command",
                return_value=SimpleNamespace(returncode=0, stdout="ok", stderr=""),
            ) as command,
            patch("backend.main.discover_serving_engines", new=AsyncMock(return_value=[state])),
            patch("backend.main.profiles_using_engine", return_value=[]),
            TestClient(app) as client,
        ):
            stopped = client.post("/api/engines/searxng/action", json={"action": "stop", "confirm": "stop searxng"})
            started = client.post("/api/engines/searxng/action", json={"action": "start", "confirm": "start searxng"})
        self.assertEqual((stopped.status_code, started.status_code), (200, 200))
        self.assertEqual(
            [call.args[0][-3:] for call in command.call_args_list if "engine" in call.args[0]],
            [["engine", "searxng", "stop"], ["engine", "searxng", "start"]],
        )

    def test_memory_map_merges_docker_client_and_container_of_one_service(self) -> None:
        def entry(pid: int, kind: str, size: int) -> dict[str, Any]:
            return {
                "pid": pid, "kind": kind, "name": kind, "alias": "", "started_at": float(pid),
                "anon_bytes": size, "file_bytes": 0, "shared_bytes": 0, "device_bytes": 0, "bytes": size,
            }

        merged = main_module.merge_runtime_trees([
            entry(10, "searxng", 25), entry(11, "llama-server", 500),
            entry(12, "searxng", 150), entry(13, "llama-server", 300),
        ])
        self.assertEqual([item["kind"] for item in merged], ["searxng", "llama-server", "llama-server"])
        self.assertEqual((merged[0]["bytes"], merged[0]["anon_bytes"], merged[0]["pid"]), (175, 175, 12))

    def test_engine_in_use_by_loaded_profile_cannot_be_stopped(self) -> None:
        with (
            patch(
                "backend.main.profiles_using_engine",
                return_value=["Audio principal"],
            ),
            patch("backend.main.run_command") as command,
            TestClient(app) as client,
        ):
            response = client.post(
                "/api/engines/whisper/action",
                json={"action": "stop", "confirm": "stop whisper"},
            )
        self.assertEqual(response.status_code, 409)
        command.assert_not_called()

    def test_spa_index_disables_cache_across_frontend_deploys(self) -> None:
        with TestClient(app) as client:
            response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["cache-control"],
            "no-cache, no-store, must-revalidate",
        )

    def test_unknown_api_route_returns_json_404(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/does-not-exist")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers["content-type"], "application/json")

    def test_dashboard_password_creates_http_only_session_and_logout_revokes_it(self) -> None:
        original = (
            settings.mydgx_dashboard_password,
            settings.mydgx_session_ttl_minutes,
            settings.mydgx_session_max_hours,
            settings.mydgx_api_key,
            settings.host,
        )
        settings.mydgx_dashboard_password = "test-only-dashboard-password"
        settings.mydgx_session_ttl_minutes = 60
        settings.mydgx_session_max_hours = 12
        settings.mydgx_api_key = None
        settings.host = "127.0.0.1"
        main_module._dashboard_login_failures.clear()
        try:
            with TestClient(app) as client:
                status = client.get("/api/auth/status")
                denied = client.get("/api/config")
                wrong = client.post("/api/auth/login", json={"password": "wrong"})
                login = client.post(
                    "/api/auth/login",
                    json={"password": "test-only-dashboard-password"},
                )
                allowed = client.get("/api/config")
                authenticated = client.get("/api/auth/status")
                refreshed = client.post("/api/auth/refresh")
                allowed_after_refresh = client.get("/api/config")
                logout = client.post("/api/auth/logout")
                denied_again = client.get("/api/config")
                refresh_denied = client.post("/api/auth/refresh")
            self.assertEqual(status.json(), {
                "required": True,
                "authenticated": False,
                "expires_in_seconds": 0,
                "session_ttl_minutes": 60,
                "session_max_hours": 12,
            })
            self.assertEqual(refreshed.status_code, 200)
            self.assertIn("HttpOnly", refreshed.headers["set-cookie"])
            self.assertIn("SameSite=strict", refreshed.headers["set-cookie"])
            self.assertEqual(allowed_after_refresh.status_code, 200)
            self.assertEqual(refresh_denied.status_code, 401)
            self.assertEqual(refresh_denied.headers["x-mydgx-auth-required"], "password")
            self.assertEqual((denied.status_code, wrong.status_code), (401, 401))
            self.assertEqual(denied.headers["x-mydgx-auth-required"], "password")
            self.assertEqual(login.status_code, 200)
            cookie = login.headers["set-cookie"]
            self.assertIn("HttpOnly", cookie)
            self.assertIn("SameSite=strict", cookie)
            self.assertIn("Max-Age=3600", cookie)
            self.assertEqual(allowed.status_code, 200)
            self.assertTrue(authenticated.json()["authenticated"])
            self.assertGreater(authenticated.json()["expires_in_seconds"], 0)
            self.assertEqual(logout.status_code, 200)
            self.assertEqual(denied_again.status_code, 401)
        finally:
            (
                settings.mydgx_dashboard_password,
                settings.mydgx_session_ttl_minutes,
                settings.mydgx_session_max_hours,
                settings.mydgx_api_key,
                settings.host,
            ) = original
            main_module._dashboard_login_failures.clear()

    def test_dashboard_session_signature_and_absolute_expiration(self) -> None:
        original = (
            settings.mydgx_dashboard_password,
            settings.mydgx_session_ttl_minutes,
            settings.mydgx_session_max_hours,
        )
        settings.mydgx_dashboard_password = "test-only-session-password"
        settings.mydgx_session_ttl_minutes = 60
        settings.mydgx_session_max_hours = 2
        try:
            token, expires_at = main_module.create_dashboard_session(now=1_000)
            self.assertEqual(expires_at, 4_600)
            self.assertEqual(
                main_module.dashboard_session_remaining(token, now=1_600),
                3_000,
            )
            self.assertEqual(
                main_module.dashboard_session_remaining(token, now=4_600),
                0,
            )
            self.assertEqual(
                main_module.dashboard_session_remaining(f"{token}x", now=1_600),
                0,
            )
            renewed, renewed_expiry = main_module.create_dashboard_session(now=4_000, issued_at=1_000)
            self.assertEqual(renewed_expiry, 7_600)
            self.assertEqual(main_module.dashboard_session_times(renewed, now=4_000), (1_000, 7_600))
            capped, capped_expiry = main_module.create_dashboard_session(now=7_000, issued_at=1_000)
            self.assertEqual(capped_expiry, 8_200)
            self.assertEqual(main_module.dashboard_session_remaining(capped, now=8_200), 0)
            settings.mydgx_session_ttl_minutes = 10
            self.assertEqual(main_module.dashboard_session_remaining(renewed, now=4_000), 0)
        finally:
            (
                settings.mydgx_dashboard_password,
                settings.mydgx_session_ttl_minutes,
                settings.mydgx_session_max_hours,
            ) = original

    def test_dashboard_login_rate_limits_repeated_failures(self) -> None:
        original = settings.mydgx_dashboard_password
        settings.mydgx_dashboard_password = "test-only-rate-limit-password"
        main_module._dashboard_login_failures.clear()
        try:
            with TestClient(app) as client:
                attempts = [
                    client.post("/api/auth/login", json={"password": "wrong"})
                    for _ in range(main_module.DASHBOARD_LOGIN_MAX_FAILURES)
                ]
                blocked = client.post(
                    "/api/auth/login",
                    json={"password": "test-only-rate-limit-password"},
                )
            self.assertTrue(all(response.status_code == 401 for response in attempts))
            self.assertEqual(blocked.status_code, 429)
            self.assertGreater(int(blocked.headers["retry-after"]), 0)
        finally:
            settings.mydgx_dashboard_password = original
            main_module._dashboard_login_failures.clear()

    def test_openwebui_tool_spec_uses_independent_bearer_auth(self) -> None:
        original = settings.openwebui_tool_api_key
        settings.openwebui_tool_api_key = "test-only-openwebui-tool-placeholder"
        try:
            with TestClient(app) as client:
                denied = client.get("/api/openwebui/tools/openapi.json")
                allowed = client.get(
                    "/api/openwebui/tools/openapi.json",
                    headers={
                        "Authorization": "Bearer test-only-openwebui-tool-placeholder",
                    },
                )
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(allowed.status_code, 200)
            paths = allowed.json()["paths"]
            self.assertIn("/api/openwebui/tools/video/jobs", paths)
            self.assertNotIn("/api/system/update", paths)
        finally:
            settings.openwebui_tool_api_key = original

    def test_assistant_searches_only_documented_sources(self) -> None:
        result = main_module.search_assistant_documents("gateway OpenAI perfiles")
        self.assertTrue(result["results"])
        self.assertTrue(all(item["source"].endswith(".md") for item in result["results"]))
        encoded = json.dumps(result)
        self.assertNotIn('".env"', json.dumps([item["source"] for item in result["results"]]))
        self.assertNotIn("test-only-secret-value", encoded)

    def test_assistant_searches_documentation_in_the_request_language(self) -> None:
        for language, query, own, other in (
            ("en", "gateway OpenAI profiles", ("README.md", "docs/en/"), ("README.es.md", "docs/es/")),
            ("es", "gateway OpenAI perfiles", ("README.es.md", "docs/es/"), ("README.md", "docs/en/")),
        ):
            sources = [item["source"] for item in main_module.search_assistant_documents(query, language)["results"]]
            self.assertTrue(any(source.startswith(own) for source in sources), (language, sources))
            self.assertFalse(any(source.startswith(other) for source in sources), (language, sources))
        reference = asyncio.run(main_module.execute_assistant_read_tool("get_api_reference", {}, "en"))
        self.assertEqual(reference["reference"], "docs/en/api.md")

    def test_assistant_executes_read_tools_and_returns_trace(self) -> None:
        first = {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "call-test",
                "type": "function",
                "function": {"name": "get_overview", "arguments": {}},
            }],
        }
        final = {"role": "assistant", "content": "El sistema está disponible.", "tool_calls": []}
        with (
            patch("backend.main.assistant_model_candidates", new=AsyncMock(return_value=["test-model"])),
            patch(
                "backend.main.call_assistant_model",
                new=AsyncMock(side_effect=[(first, "test-model"), (final, "test-model")]),
            ),
            patch(
                "backend.main.execute_assistant_read_tool",
                new=AsyncMock(return_value={"metrics": {"cpu_percent": 10}}),
            ),
            TestClient(app) as client,
        ):
            response = client.post("/api/assistant/chat", json={"message": "Dame el resumen"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "test-model")
        self.assertEqual(response.json()["tools_used"], [{"name": "get_overview", "status": "ok"}])

    def test_assistant_status_reports_model_and_documentation_readiness(self) -> None:
        with (
            patch(
                "backend.main.ollama_payload",
                new=AsyncMock(return_value={"models": [{"name": settings.assistant_model}]}),
            ),
            TestClient(app) as client,
        ):
            response = client.get("/api/assistant/status")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["preferred_available"])
        self.assertGreater(payload["documentation_chunks"], 0)
        self.assertTrue(payload["action_confirmation_required"])
        self.assertIn("recommend_models", payload["read_tools"])
        self.assertIn("download_huggingface_model", payload["action_tools"])

    def test_assistant_recommendation_tool_uses_mydgx_ranking(self) -> None:
        ranked = [{
            "id": "org/coder-GGUF",
            "recommended_score": 87,
            "recommendation_status": "Ideal",
            "community_score": 74,
            "downloads": 1000,
            "likes": 50,
            "trending_score": 12,
            "tasks": ["chat", "code"],
            "recommended_quantization": "Q4_K_M",
            "recommended_context": 32768,
            "estimated_tokens_per_second": 20,
            "recommended_slots": 2,
            "estimated_memory_mb": 12000,
            "memory_budget_mb": 100000,
            "fits": True,
            "architecture": "Dense",
            "active_parameters_b": None,
            "runtime_requirement": "llama.cpp",
            "reasons": ["Cabe en memoria"],
            "warnings": [],
        }]
        with patch(
            "backend.main.search_models",
            new=AsyncMock(return_value=ranked),
        ) as search:
            result = asyncio.run(main_module.execute_assistant_read_tool(
                "recommend_models",
                {
                    "query": "coder",
                    "task": "code",
                    "runtime": "llama.cpp",
                    "format": "gguf",
                    "limit": 3,
                },
            ))
        self.assertEqual(result["recommendations"][0]["recommended_score"], 87)
        self.assertEqual(result["recommendations"][0]["community_score"], 74)
        search.assert_awaited_once()

    def test_assistant_recommendation_prefers_trusted_high_quality_quantization(self) -> None:
        common = {
            "fits": True,
            "fits_now": False,
            "community_score": 70,
            "downloads": 1000,
            "estimated_memory_mb": 8000,
            "memory_budget_mb": 100000,
            "memory_available_budget_mb": 1000,
            "warnings": [],
        }
        ranked = [
            {
                **common,
                "id": "unknown/Large-Coder-GGUF",
                "recommended_score": 90,
                "recommended_quantization": "IQ2_XXS",
                "trusted_publisher": False,
            },
            {
                **common,
                "id": "Qwen/Small-Coder-GGUF",
                "recommended_score": 75,
                "recommended_quantization": "Q8_0",
                "trusted_publisher": True,
            },
        ]
        with (
            patch("backend.main.search_models", new=AsyncMock(return_value=ranked)),
            patch(
                "backend.main.device_identity",
                return_value={"device_model": "DGX", "is_dgx_spark": True},
            ),
        ):
            result = asyncio.run(main_module.execute_assistant_read_tool(
                "recommend_models",
                {"query": "coder", "task": "code", "limit": 2},
            ))

        self.assertEqual(result["recommendations"][0]["id"], "Qwen/Small-Coder-GGUF")

    def test_assistant_routes_only_relevant_tools_to_lightweight_model(self) -> None:
        model_tools = {
            item["function"]["name"]
            for item in main_module.assistant_tools_for_messages([
                {"role": "user", "content": "Recomiéndame y descarga un modelo de código"},
            ])
        }
        system_tools = {
            item["function"]["name"]
            for item in main_module.assistant_tools_for_messages([
                {"role": "user", "content": "Resume temperatura, memoria y GPU"},
            ])
        }
        self.assertIn("recommend_models", model_tools)
        self.assertIn("download_huggingface_model", model_tools)
        self.assertIn("get_metrics_summary", system_tools)
        self.assertNotIn("download_huggingface_model", system_tools)
        self.assertLess(len(system_tools), len(main_module.ASSISTANT_TOOLS))

    def test_every_assistant_tool_has_an_implementation(self) -> None:
        import inspect

        read_source = inspect.getsource(main_module.execute_assistant_read_tool)
        validate_source = inspect.getsource(main_module.validate_assistant_action)
        confirm_source = inspect.getsource(main_module.confirm_assistant_action)
        names = {tool["function"]["name"] for tool in main_module.ASSISTANT_TOOLS}
        self.assertTrue(main_module.ASSISTANT_ACTION_TOOLS <= names)
        for name in names:
            if name in main_module.ASSISTANT_ACTION_TOOLS:
                self.assertIn(f'"{name}"', validate_source, name)
                self.assertIn(f'"{name}"', confirm_source, name)
            else:
                self.assertIn(f'"{name}"', read_source, name)

    def test_assistant_routes_api_memory_and_app_questions(self) -> None:
        def tools_for(text: str) -> set[str]:
            return {
                item["function"]["name"]
                for item in main_module.assistant_tools_for_messages([{"role": "user", "content": text}])
            }

        self.assertIn("get_api_reference", tools_for("¿Cómo arranco un perfil con curl desde un script?"))
        self.assertIn("release_memory", tools_for("Libera memoria, necesito sitio para un modelo grande"))
        self.assertIn("control_engine", tools_for("Desactiva ComfyUI"))
        self.assertIn("profile_app_action", tools_for("Reinicia la app ragkit"))
        self.assertIn("get_updates", tools_for("¿Hay actualizaciones de seguridad?"))

    def test_assistant_api_reference_matches_docs_without_secrets(self) -> None:
        main_module.api_reference_entries.cache_clear()
        with (
            patch.object(settings, "mydgx_api_key", "unit-test-secret-value"),
            patch.object(settings, "gateway_api_key", "unit-test-gateway-secret"),
        ):
            filtered = asyncio.run(main_module.execute_assistant_read_tool(
                "get_api_reference", {"query": "liberar memoria"},
            ))
            overview = asyncio.run(main_module.execute_assistant_read_tool("get_api_reference", {}))
        paths = [item["path"] for item in filtered["endpoints"]]
        self.assertIn("/api/memory-mode/release", paths)
        self.assertGreater(filtered["total_endpoints"], 100)
        self.assertTrue(filtered["authentication"]["dashboard_key_required"])
        self.assertTrue(any(area["area"] == "Gateway (`/v1`)" for area in overview["endpoints"]))
        encoded = json.dumps([filtered, overview])
        self.assertNotIn("unit-test-secret-value", encoded)
        self.assertNotIn("unit-test-gateway-secret", encoded)

    def test_assistant_validates_engine_app_and_memory_actions(self) -> None:
        self.assertEqual(
            main_module.validate_assistant_action("control_engine", {"engine_id": "comfyui", "action": "start"}),
            {"engine_id": "comfyui", "action": "start"},
        )
        with self.assertRaises(HTTPException) as unknown:
            main_module.validate_assistant_action("control_engine", {"engine_id": "ollama", "action": "stop"})
        self.assertEqual(unknown.exception.status_code, 400)
        with (
            patch("backend.main.profiles_using_engine", return_value=["Imagen"]),
            self.assertRaises(HTTPException) as busy,
        ):
            main_module.validate_assistant_action("control_engine", {"engine_id": "comfyui", "action": "stop"})
        self.assertEqual(busy.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            main_module.validate_assistant_action("profile_app_action", {"name": "../etc", "action": "start"})
        with self.assertRaises(HTTPException):
            main_module.validate_assistant_action("release_memory", {"services": ["sshd"]})
        release = main_module.validate_assistant_action(
            "release_memory", {"services": ["comfyui", "comfyui", "whisper"], "stop_profiles": True},
        )
        self.assertEqual(release["services"], ["comfyui", "whisper"])
        self.assertIn("ComfyUI", main_module.assistant_action_label("release_memory", release))
        with (
            patch("backend.main.memory_mode_state", return_value={"stopped": [], "profiles": []}),
            self.assertRaises(HTTPException) as nothing,
        ):
            main_module.validate_assistant_action("restore_memory", {})
        self.assertEqual(nothing.exception.status_code, 409)

    def test_assistant_engine_action_runs_only_after_confirmation(self) -> None:
        action = main_module.create_assistant_pending_action(
            "control_engine", {"engine_id": "whisper", "action": "stop"},
        )
        with (
            patch("backend.main.engine_action", new=AsyncMock(return_value={"success": True})) as engine,
            TestClient(app) as client,
        ):
            engine.assert_not_called()
            response = client.post("/api/assistant/actions/confirm", json={"action_id": action["id"]})
        self.assertEqual(response.status_code, 200)
        engine_id, payload = engine.await_args.args
        self.assertEqual(engine_id, "whisper")
        self.assertEqual(payload.confirm, "stop whisper")

    def test_assistant_recent_events_can_filter_errors(self) -> None:
        main_module.db.log("error", "runtime", "unit.assistant.filter", "fallo de prueba asistente")
        main_module.db.log("info", "runtime", "unit.assistant.filter", "todo bien asistente")
        result = asyncio.run(main_module.execute_assistant_read_tool(
            "get_recent_events", {"level": "error", "query": "unit.assistant.filter", "limit": 5},
        ))
        self.assertTrue(result["logs"])
        self.assertTrue(all(row["level"] == "error" for row in result["logs"]))

    def test_assistant_validates_model_download_actions(self) -> None:
        huggingface = main_module.validate_assistant_action(
            "download_huggingface_model",
            {"repo_id": "org/model-GGUF", "revision": "main"},
        )
        ollama = main_module.validate_assistant_action(
            "download_ollama_model",
            {"name": "llama3.2:3b"},
        )
        self.assertEqual(huggingface["repo_id"], "org/model-GGUF")
        self.assertEqual(ollama["name"], "llama3.2:3b")
        with self.assertRaises(HTTPException):
            main_module.validate_assistant_action(
                "download_huggingface_model",
                {"repo_id": "../../secret", "revision": "main"},
            )

    def test_assistant_actions_require_a_second_confirmed_request(self) -> None:
        action = main_module.create_assistant_pending_action(
            "stop_profile", {"profile_id": "__all__"}
        )
        with (
            patch("backend.main.stop_profile", new=AsyncMock(return_value={"stopped": True})) as stop,
            TestClient(app) as client,
        ):
            stop.assert_not_called()
            response = client.post(
                "/api/assistant/actions/confirm",
                json={"action_id": action["id"]},
            )
        self.assertEqual(response.status_code, 200)
        stop.assert_awaited_once()

    def test_assistant_chat_proposes_but_does_not_execute_actions(self) -> None:
        proposal = {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "call-stop",
                "type": "function",
                "function": {"name": "stop_profile", "arguments": {"profile_id": "__all__"}},
            }],
        }
        final = {
            "role": "assistant",
            "content": "Confirma la detención en la interfaz.",
            "tool_calls": [],
        }
        with (
            patch("backend.main.assistant_model_candidates", new=AsyncMock(return_value=["test-model"])),
            patch(
                "backend.main.call_assistant_model",
                new=AsyncMock(side_effect=[(proposal, "test-model"), (final, "test-model")]),
            ),
            patch("backend.main.stop_profile", new=AsyncMock()) as stop,
            TestClient(app) as client,
        ):
            response = client.post(
                "/api/assistant/chat",
                json={"message": "Detén todos los perfiles"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pending_actions"][0]["name"], "stop_profile")
        stop.assert_not_awaited()

    def test_assistant_stops_repeated_tool_loop_and_synthesizes_results(self) -> None:
        repeated = {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "call-recommend",
                "type": "function",
                "function": {
                    "name": "recommend_models",
                    "arguments": {"query": "coder", "task": "code", "limit": 3},
                },
            }],
        }
        empty_final = {"role": "assistant", "content": "", "tool_calls": []}
        tool_result = {
            "query": "coder",
            "count": 1,
            "recommendations": [{
                "id": "org/coder-GGUF",
                "recommended_score": 82,
                "community_score": 70,
                "recommended_quantization": "Q4_K_M",
                "estimated_memory_mb": 12_288,
                "estimated_tokens_per_second": 18,
                "fits": True,
                "warnings": [],
            }],
        }
        execute = AsyncMock(return_value=tool_result)
        with (
            patch("backend.main.assistant_model_candidates", new=AsyncMock(return_value=["test-model"])),
            patch(
                "backend.main.call_assistant_model",
                new=AsyncMock(side_effect=[
                    (repeated, "test-model"),
                    (repeated, "test-model"),
                    (empty_final, "test-model"),
                ]),
            ) as call_model,
            patch("backend.main.execute_assistant_read_tool", new=execute),
            TestClient(app) as client,
        ):
            response = client.post(
                "/api/assistant/chat",
                json={"message": "Busca candidatos de código adecuados"},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("org/coder-GGUF", payload["message"]["content"])
        self.assertNotIn("No pude generar", payload["message"]["content"])
        self.assertEqual(payload["tools_used"], [{"name": "recommend_models", "status": "ok"}])
        execute.assert_awaited_once()
        self.assertEqual(call_model.await_count, 3)
        self.assertFalse(call_model.await_args.kwargs["tools_enabled"])

    def test_assistant_routes_clear_recommendations_without_llm_arguments(self) -> None:
        recommendations = {
            "query": "coder",
            "count": 3,
            "recommendations": [
                {
                    "id": f"org/coder-{index}",
                    "recommended_score": 80 - index,
                    "community_score": 70,
                    "estimated_memory_mb": 4096,
                    "fits": True,
                    "warnings": [],
                }
                for index in range(1, 4)
            ],
        }
        execute = AsyncMock(return_value=recommendations)
        call_model = AsyncMock()
        with (
            patch("backend.main.execute_assistant_read_tool", new=execute),
            patch("backend.main.call_assistant_model", new=call_model),
            TestClient(app) as client,
        ):
            response = client.post(
                "/api/assistant/chat",
                json={"message": "Recomiéndame tres modelos de código que quepan en este equipo"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "mydgx-recommender")
        self.assertEqual(payload["tools_used"], [{"name": "recommend_models", "status": "ok"}])
        self.assertIn("org/coder-1", payload["message"]["content"])
        self.assertEqual(execute.await_args.args[1]["task"], "code")
        self.assertEqual(execute.await_args.args[1]["limit"], 3)
        self.assertEqual(execute.await_args.args[1]["alignment"], "standard")
        call_model.assert_not_awaited()

    def test_assistant_fallback_skips_models_below_minimum_size(self) -> None:
        original_model = settings.assistant_model
        original_minimum = settings.assistant_min_fallback_parameters_b
        settings.assistant_model = "configured:1b"
        settings.assistant_min_fallback_parameters_b = 3
        try:
            with (
                patch("backend.main.running_profiles", return_value=[{"id": "running"}]),
                patch(
                    "backend.main.running_profile_models",
                    return_value=[
                        {"id": "tiny", "name": "Qwen3 0.6B", "task": "chat"},
                        {"id": "capable", "name": "Qwen 3B", "task": "chat"},
                    ],
                ),
                patch("backend.main.active_profile", return_value=None),
                patch(
                    "backend.main.ollama_payload",
                    new=AsyncMock(return_value={"models": [
                        {"name": "small:latest", "details": {"parameter_size": "1.5B"}},
                        {"name": "large:latest", "details": {"parameter_size": "7B"}},
                    ]}),
                ),
            ):
                candidates = asyncio.run(
                    main_module.assistant_model_candidates("explicit:0.6b")
                )
        finally:
            settings.assistant_model = original_model
            settings.assistant_min_fallback_parameters_b = original_minimum

        self.assertEqual(candidates[:2], ["explicit:0.6b", "configured:1b"])
        self.assertIn("profile:running:capable", candidates)
        self.assertIn("large:latest", candidates)
        self.assertNotIn("profile:running:tiny", candidates)
        self.assertNotIn("small:latest", candidates)

    def test_recommend_models_normalizes_small_model_arguments_and_retries(self) -> None:
        recommendation = {
            "id": "org/coder-GGUF",
            "recommended_score": 88,
            "fits": True,
        }
        search = AsyncMock(side_effect=[[], [recommendation]])
        with patch("backend.main.search_models", new=search):
            result = asyncio.run(
                main_module.execute_assistant_read_tool(
                    "recommend_models",
                    {
                        "query": "models for code generation on NVIDIA GB10",
                        "task": "code-generation",
                        "modality": "code",
                        "limit": "3",
                    },
                )
            )

        self.assertEqual(result["effective_query"], "coder")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["recommendations"][0]["id"], "org/coder-GGUF")
        self.assertEqual(search.await_count, 2)
        self.assertEqual(search.await_args_list[0].args[1], "code")
        self.assertEqual(search.await_args_list[0].args[6], "text")
        self.assertEqual(search.await_args_list[0].args[7], 20)

    def test_assistant_rejects_unknown_action_targets_before_proposal(self) -> None:
        with self.assertRaisesRegex(HTTPException, "Perfil no encontrado"):
            main_module.validate_assistant_action(
                "start_profile", {"profile_id": "missing-profile"}
            )

    def test_generated_artifact_is_served_from_private_data_directory(self) -> None:
        original_database_path = settings.database_path
        with tempfile.TemporaryDirectory() as directory:
            settings.database_path = str(Path(directory) / "mydgx.db")
            artifact_id = "12345678-1234-1234-1234-123456789abc"
            artifact_dir = Path(directory) / "artifacts"
            artifact_dir.mkdir()
            (artifact_dir / f"{artifact_id}.webm").write_bytes(b"video")
            try:
                with TestClient(app) as client:
                    response = client.get(f"/api/artifacts/{artifact_id}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "video/webm")
                self.assertEqual(response.content, b"video")
            finally:
                settings.database_path = original_database_path

    def test_logs_endpoint_filters_persistent_events(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "logs-api.db"
            with TestClient(app) as client:
                db.log(
                    "warning",
                    "test-category",
                    "test.warning",
                    "Aviso de prueba",
                    entity_type="test",
                    entity_id="one",
                    detail={"attempt": 2},
                )
                response = client.get(
                    "/api/logs",
                    params={"level": "warning", "category": "test-category"},
                )
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(payload["entries"][0]["action"], "test.warning")
                self.assertEqual(payload["entries"][0]["detail"]["attempt"], 2)
                self.assertGreaterEqual(payload["retention_days"], 1)
        db.path = original_path

    def test_metrics_history_supports_explicit_time_windows(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "metrics-history.db"
            with TestClient(app) as client:
                db.execute(
                    """
                    INSERT INTO metric_samples(
                        created_at,cpu_percent,memory_percent,memory_used,memory_total,
                        gpu_utilization,gpu_memory_used,gpu_memory_total,gpu_temperature,
                        gpu_power_watts,gpu_power_limit_watts,disk_percent,disk_used,disk_total,
                        disk_read_bytes,disk_write_bytes,network_sent,network_received
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        "2024-01-01T12:30:00+00:00", 10, 20, 2, 10,
                        30, 3, 10, 40, 45, 120, 50, 5, 10,
                        1000, 2000, 3000, 4000,
                    ),
                )
                response = client.get(
                    "/api/metrics/history",
                    params={
                        "start": "2024-01-01T12:00:00+00:00",
                        "end": "2024-01-01T13:00:00+00:00",
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()), 1)
                self.assertEqual(response.json()[0]["gpu_power_watts"], 45)
                invalid = client.get(
                    "/api/metrics/history",
                    params={
                        "start": "2024-01-01T13:00:00+00:00",
                        "end": "2024-01-01T12:00:00+00:00",
                    },
                )
                self.assertEqual(invalid.status_code, 422)
        db.path = original_path

    def test_job_status_endpoint_returns_current_progress_and_events(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "job-status.db"
            with TestClient(app) as client:
                job_id = db.create_job("profile.prepare-start", "profile-1")
                db.update_job(job_id, "running", 82, "Cargando modelos")
                response = client.get(f"/api/jobs/{job_id}")
                missing = client.get("/api/jobs/does-not-exist")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["progress"], 82)
            self.assertEqual(response.json()["events"][0]["message"], "Cargando modelos")
            self.assertEqual(missing.status_code, 404)
        db.path = original_path

    def test_huggingface_file_download_is_pinned_after_size_check(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "hf-download.db"
            info = SimpleNamespace(
                sha="resolved-sha",
                siblings=[SimpleNamespace(rfilename="model.gguf", size=80)],
            )
            with (
                patch("backend.main.HfApi") as api,
                patch("backend.main.model_download_memory_limit_bytes", return_value=100),
                patch("backend.main.download_hf_files", new=AsyncMock()) as download,
                TestClient(app) as client,
            ):
                api.return_value.model_info.return_value = info
                response = client.post("/api/models/huggingface/files/download", json={
                    "repo_id": "org/model-GGUF",
                    "files": ["model.gguf"],
                })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(download.await_args.args[1].revision, "resolved-sha")
        db.path = original_path

    def test_huggingface_shared_engram_is_excluded_from_resident_limit(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "hf-engram-download.db"
            files = [
                SimpleNamespace(
                    rfilename=f"IQ2_XXS/DeepSeek-Coder-{index:05d}-of-00006.gguf",
                    size=10,
                )
                for index in range(1, 6)
            ]
            files.append(SimpleNamespace(rfilename="DeepSeek-Engram-IQ4_NL.gguf", size=80))
            info = SimpleNamespace(sha="resolved-sha", siblings=files)
            selected = [item.rfilename for item in files]
            with (
                patch("backend.main.HfApi") as api,
                patch("backend.main.model_download_memory_limit_bytes", return_value=100),
                patch("backend.main.download_hf_files", new=AsyncMock()),
                TestClient(app) as client,
            ):
                api.return_value.model_info.return_value = info
                response = client.post("/api/models/huggingface/files/download", json={
                    "repo_id": "org/deepseek-coder-GGUF",
                    "files": selected,
                })
            self.assertEqual(response.status_code, 200)
        db.path = original_path

    def test_huggingface_file_download_reuses_active_job(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "hf-download-deduplicated.db"
            db.initialize()
            with (
                patch("backend.main.validate_hf_download", new=AsyncMock()) as validate,
                TestClient(app) as client,
            ):
                job_id = db.create_job("huggingface.files.download", "org/model-GGUF")
                response = client.post("/api/models/huggingface/files/download", json={
                    "repo_id": "org/model-GGUF",
                    "files": ["model-Q8_0.gguf"],
                })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"job_id": job_id, "deduplicated": True})
            validate.assert_not_awaited()
            self.assertEqual(len(db.rows("SELECT id FROM jobs")), 1)
        db.path = original_path

    def test_huggingface_file_download_rejects_existing_file(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db.path = root / "hf-download-existing.db"
            cache = root / "hub"
            cached = cache / "models--org--model-GGUF" / "snapshots" / "resolved-sha" / "model-Q8_0.gguf"
            cached.parent.mkdir(parents=True)
            cached.write_bytes(b"already here")
            info = SimpleNamespace(
                sha="resolved-sha",
                siblings=[SimpleNamespace(rfilename="model-Q8_0.gguf", size=80)],
            )
            with (
                patch("backend.main.HfApi") as api,
                patch("backend.main.huggingface_cache_dir", return_value=cache),
                patch("backend.main.model_download_memory_limit_bytes", return_value=100),
                TestClient(app) as client,
            ):
                api.return_value.model_info.return_value = info
                response = client.post("/api/models/huggingface/files/download", json={
                    "repo_id": "org/model-GGUF",
                    "files": ["model-Q8_0.gguf"],
                })
                jobs = db.rows("SELECT id FROM jobs WHERE kind='huggingface.files.download'")
            self.assertEqual(response.status_code, 409)
            self.assertIn("ya está descargado", response.json()["detail"])
            self.assertEqual(jobs, [])
        db.path = original_path

    def test_huggingface_file_download_skips_files_already_in_cache(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db.path = root / "hf-download-partial.db"
            cache = root / "hub"
            cached = cache / "models--org--model-GGUF" / "snapshots" / "resolved-sha" / "model-DFlash2-Q8_0.gguf"
            cached.parent.mkdir(parents=True)
            cached.write_bytes(b"drafter")
            info = SimpleNamespace(
                sha="resolved-sha",
                siblings=[
                    SimpleNamespace(rfilename="model-Mix-15.7G.gguf", size=60),
                    SimpleNamespace(rfilename="model-DFlash2-Q8_0.gguf", size=20),
                ],
            )
            with (
                patch("backend.main.HfApi") as api,
                patch("backend.main.huggingface_cache_dir", return_value=cache),
                patch("backend.main.model_download_memory_limit_bytes", return_value=100),
                patch("backend.main.download_hf_files", new=AsyncMock()) as download,
                TestClient(app) as client,
            ):
                api.return_value.model_info.return_value = info
                response = client.post("/api/models/huggingface/files/download", json={
                    "repo_id": "org/model-GGUF",
                    "files": ["model-Mix-15.7G.gguf", "model-DFlash2-Q8_0.gguf"],
                })
            self.assertEqual(response.status_code, 200)
            queued = download.await_args.args
            self.assertEqual(queued[1].files, ["model-Mix-15.7G.gguf"])
            self.assertEqual(queued[2], 60)
        db.path = original_path

    def test_huggingface_download_reports_byte_progress_of_incomplete_blobs(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "hf-progress.db"
            db.initialize()
            cache = Path(directory) / "hub"
            blobs = cache / "models--org--model-GGUF" / "blobs"
            blobs.mkdir(parents=True)
            (blobs / "existing").write_bytes(b"x" * 500)
            job_id = db.create_job("huggingface.files.download", "org/model-GGUF")

            async def scenario() -> dict[str, Any]:
                stop = asyncio.Event()
                monitor = asyncio.create_task(main_module.track_hf_download_progress(
                    job_id, "org/model-GGUF", 1000, stop, lambda: "Descargando",
                ))
                await asyncio.sleep(0.02)
                (blobs / "abc.incomplete").write_bytes(b"y" * 400)
                await asyncio.sleep(0.12)
                await main_module.stop_hf_progress(stop, monitor)
                return db.rows("SELECT progress,message FROM jobs WHERE id=?", (job_id,))[0]

            with (
                patch("backend.main.huggingface_cache_dir", return_value=cache),
                patch("backend.main.HF_PROGRESS_INTERVAL_SECONDS", 0.05),
            ):
                job = asyncio.run(scenario())
        db.path = original_path
        self.assertAlmostEqual(job["progress"], 40.0)
        self.assertIn("400 B / 1000 B", job["message"])

    def test_huggingface_download_reports_byte_progress_of_incomplete_blobs(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "hf-progress.db"
            db.initialize()
            cache = Path(directory) / "hub"
            blobs = cache / "models--org--model-GGUF" / "blobs"
            blobs.mkdir(parents=True)
            (blobs / "existing").write_bytes(b"x" * 500)
            job_id = db.create_job("huggingface.files.download", "org/model-GGUF")

            async def scenario() -> dict[str, Any]:
                stop = asyncio.Event()
                monitor = asyncio.create_task(main_module.track_hf_download_progress(
                    job_id, "org/model-GGUF", 1000, stop, lambda: "Descargando",
                ))
                await asyncio.sleep(0.02)
                (blobs / "abc.incomplete").write_bytes(b"y" * 400)
                await asyncio.sleep(0.12)
                await main_module.stop_hf_progress(stop, monitor)
                return db.rows("SELECT progress,message FROM jobs WHERE id=?", (job_id,))[0]

            with (
                patch("backend.main.huggingface_cache_dir", return_value=cache),
                patch("backend.main.HF_PROGRESS_INTERVAL_SECONDS", 0.05),
            ):
                job = asyncio.run(scenario())
        db.path = original_path
        self.assertAlmostEqual(job["progress"], 40.0)
        self.assertIn("400 B / 1000 B", job["message"])

    def test_huggingface_file_download_rejects_size_over_memory(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "hf-too-large.db"
            info = SimpleNamespace(
                sha="resolved-sha",
                siblings=[SimpleNamespace(rfilename="model.gguf", size=101)],
            )
            with (
                patch("backend.main.HfApi") as api,
                patch("backend.main.model_download_memory_limit_bytes", return_value=100),
                TestClient(app) as client,
            ):
                api.return_value.model_info.return_value = info
                response = client.post("/api/models/huggingface/files/download", json={
                    "repo_id": "org/model-GGUF",
                    "files": ["model.gguf"],
                })
                jobs = db.rows("SELECT * FROM jobs WHERE kind='huggingface.files.download'")
            self.assertEqual(response.status_code, 413)
            self.assertIn("Descarga bloqueada", response.json()["detail"])
            self.assertEqual(jobs, [])
        db.path = original_path

    def test_huggingface_download_rejects_unknown_or_oversized_snapshot(self) -> None:
        unknown = SimpleNamespace(
            sha="resolved-sha",
            siblings=[SimpleNamespace(rfilename="model.gguf", size=None)],
        )
        oversized = SimpleNamespace(
            sha="resolved-sha",
            siblings=[
                SimpleNamespace(rfilename="model.gguf", size=80),
                SimpleNamespace(rfilename="model-2.gguf", size=30),
            ],
        )
        with (
            patch("backend.main.HfApi") as api,
            patch("backend.main.model_download_memory_limit_bytes", return_value=100),
            patch("backend.main.backfill_hf_model_descriptions", new=AsyncMock()),
            TestClient(app) as client,
        ):
            api.return_value.model_info.side_effect = [unknown, oversized]
            unknown_response = client.post("/api/models/huggingface/files/download", json={
                "repo_id": "org/model-GGUF",
                "files": ["model.gguf"],
            })
            snapshot_response = client.post("/api/models/huggingface/download", json={
                "repo_id": "org/model-GGUF",
            })
        self.assertEqual(unknown_response.status_code, 409)
        self.assertIn("no informa el tamaño", unknown_response.json()["detail"])
        self.assertEqual(snapshot_response.status_code, 413)

    def test_ollama_pull_stops_when_announced_size_exceeds_memory(self) -> None:
        original_path = db.path

        class FakeResponse:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                yield json.dumps({"status": "pulling", "total": 101, "completed": 1})
                raise AssertionError("The oversized stream must stop immediately")

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def stream(self, *_args, **_kwargs):
                return FakeResponse()

        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "ollama-too-large.db"
            db.initialize()
            job_id = db.create_job("ollama.pull", "large:latest")
            with (
                patch("backend.main.httpx.AsyncClient", return_value=FakeClient()),
                patch("backend.main.model_download_memory_limit_bytes", return_value=100),
            ):
                asyncio.run(main_module.pull_ollama(job_id, "large:latest"))
            job = db.rows("SELECT status,message FROM jobs WHERE id=?", (job_id,))[0]
            self.assertEqual(job["status"], "failed")
            self.assertIn("Descarga bloqueada", job["message"])
        db.path = original_path

    def test_env_settings_write_only_token_and_validated_values(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "env.db"
            env_file = Path(directory) / ".env"
            env_file.write_text("# comentario\nHF_TOKEN=hf_previousTokenValue0000\nHF_DOWNLOAD_WORKERS=4\nPORT=8088\n", encoding="utf-8")
            new_token = "hf_" + "a" * 30
            with (
                patch.object(main_module, "ENV_FILE", env_file),
                patch.object(settings, "hf_token", "hf_previousTokenValue0000"),
                patch.object(settings, "hf_download_workers", 4),
                patch.object(settings, "benchmark_repetitions", 3),
                patch("backend.main.HfApi") as api,
                TestClient(app) as client,
            ):
                api.return_value.whoami.return_value = {"name": "tester"}
                snapshot = client.get("/api/settings/env")
                self.assertEqual(snapshot.status_code, 200)
                self.assertNotIn("hf_previousTokenValue0000", snapshot.text)
                self.assertTrue(snapshot.json()["hf_token_configured"])

                rejected = client.put("/api/settings/env", json={"values": {"PORT": 9000}})
                self.assertEqual(rejected.status_code, 400)
                out_of_range = client.put("/api/settings/env", json={"values": {"HF_DOWNLOAD_WORKERS": 99}})
                self.assertEqual(out_of_range.status_code, 400)
                injected = client.put("/api/settings/env", json={"values": {"ASSISTANT_MODEL": "x\nMYDGX_API_KEY=y"}})
                self.assertEqual(injected.status_code, 400)

                saved = client.put("/api/settings/env", json={
                    "values": {"HF_DOWNLOAD_WORKERS": 8, "BENCHMARK_REPETITIONS": 2},
                    "hf_token": new_token,
                })
                self.assertEqual(saved.status_code, 200)
                self.assertNotIn(new_token, saved.text)
                self.assertEqual(saved.json()["hf_user"], "tester")
                self.assertEqual(settings.hf_download_workers, 8)
                self.assertEqual(settings.hf_token, new_token)
                content = env_file.read_text(encoding="utf-8")
                self.assertIn("# comentario", content)
                self.assertIn(f"HF_TOKEN={new_token}", content)
                self.assertIn("HF_DOWNLOAD_WORKERS=8", content)
                self.assertIn("BENCHMARK_REPETITIONS=2", content)
                self.assertIn("PORT=8088", content)
                self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)

                cleared = client.put("/api/settings/env", json={"clear_hf_token": True})
                self.assertEqual(cleared.status_code, 200)
                self.assertFalse(cleared.json()["hf_token_configured"])
                self.assertIsNone(main_module.huggingface_token())
                self.assertIn("HF_TOKEN=\n", env_file.read_text(encoding="utf-8"))
        db.path = original_path

    def test_privileged_switches_need_confirmation_only_to_turn_on(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "privileged.db"
            env_file = Path(directory) / ".env"
            env_file.write_text("ENABLE_SYSTEM_UPDATES=false\n", encoding="utf-8")
            with (
                patch.object(main_module, "ENV_FILE", env_file),
                patch.object(settings, "enable_system_updates", False),
                patch.object(settings, "enable_firmware_updates", False),
                patch.object(settings, "enable_service_control", False),
                TestClient(app) as client,
            ):
                unconfirmed = client.put("/api/settings/env", json={"values": {"ENABLE_FIRMWARE_UPDATES": True}})
                self.assertEqual(unconfirmed.status_code, 400)
                wrong = client.put("/api/settings/env", json={
                    "values": {"ENABLE_FIRMWARE_UPDATES": True},
                    "confirmations": {"ENABLE_FIRMWARE_UPDATES": "ACTIVAR ACTUALIZACIONES"},
                })
                self.assertEqual(wrong.status_code, 400)
                self.assertFalse(settings.enable_firmware_updates)

                enabled = client.put("/api/settings/env", json={
                    "values": {"ENABLE_SYSTEM_UPDATES": True, "ENABLE_FIRMWARE_UPDATES": True},
                    "confirmations": {"ENABLE_SYSTEM_UPDATES": "ACTIVAR ACTUALIZACIONES", "ENABLE_FIRMWARE_UPDATES": "ACTIVAR FIRMWARE"},
                })
                self.assertEqual(enabled.status_code, 200)
                self.assertTrue(settings.enable_system_updates and settings.enable_firmware_updates)
                self.assertIn("ENABLE_FIRMWARE_UPDATES=true", env_file.read_text(encoding="utf-8"))
                notices = db.rows("SELECT kind,level FROM notifications WHERE kind='settings.privileged.enabled'")
                self.assertEqual([(item["kind"], item["level"]) for item in notices], [("settings.privileged.enabled", "warning")])

                services = client.put("/api/settings/env", json={"values": {"ENABLE_SERVICE_CONTROL": True}})
                self.assertEqual(services.status_code, 400)
                services = client.put("/api/settings/env", json={
                    "values": {"ENABLE_SERVICE_CONTROL": True},
                    "confirmations": {"ENABLE_SERVICE_CONTROL": "ACTIVAR SERVICIOS"},
                })
                self.assertEqual(services.status_code, 200)
                self.assertTrue(settings.enable_service_control)

                disabled = client.put("/api/settings/env", json={"values": {"ENABLE_FIRMWARE_UPDATES": False}})
                self.assertEqual(disabled.status_code, 200)
                self.assertFalse(settings.enable_firmware_updates)
                self.assertIn("ENABLE_FIRMWARE_UPDATES=false", env_file.read_text(encoding="utf-8"))
        db.path = original_path

    def test_gated_access_probe_distinguishes_token_states(self) -> None:
        files = ["README.md", "model-Q4_K_M.gguf"]
        response = httpx.Response(401, request=httpx.Request("GET", "https://huggingface.co/org/model"))
        gated = main_module.GatedRepoError("gated", response=response)
        with patch.object(main_module, "get_hf_file_metadata", side_effect=gated) as probe:
            with patch.object(main_module, "huggingface_token", return_value=None):
                self.assertEqual(main_module.hf_gated_access("org/model", "main", files), "no_token")
            with patch.object(main_module, "huggingface_token", return_value="hf_placeholder_token_value"):
                self.assertEqual(main_module.hf_gated_access("org/model", "main", files), "denied")
            self.assertIn("model-Q4_K_M.gguf", probe.call_args.args[0])
        with patch.object(main_module, "get_hf_file_metadata", return_value=object()):
            self.assertEqual(main_module.hf_gated_access("org/model", "main", files), "granted")
        self.assertEqual(main_module.hf_gated_mode(SimpleNamespace(gated="manual")), "manual")
        self.assertEqual(main_module.hf_gated_mode(SimpleNamespace(gated=False)), "")

    def test_notifications_dedupe_redact_and_mark_read(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "notifications.db"
            with TestClient(app) as client:
                db.notify("download.failed", "Descarga fallida", "org/model: sin acceso", target="org/model", log="Authorization: Bearer hf_secretvalue123456789")
                db.notify("download.failed", "Descarga fallida", "org/model: sin acceso", target="org/model")
                db.notify("benchmark.failed", "Error ejecutando benchmark", "gguf:abc: fallo", target="gguf:abc")
                listed = client.get("/api/notifications").json()
                self.assertEqual(listed["unread"], 2)
                self.assertEqual([item["kind"] for item in listed["items"]], ["benchmark.failed", "download.failed"])
                self.assertNotIn("hf_secretvalue123456789", json.dumps(listed))
                read = client.post("/api/notifications/read", json={"ids": [listed["items"][0]["id"]]}).json()
                self.assertEqual(read["unread"], 1)
                self.assertEqual(client.post("/api/notifications/read", json={"all": True}).json()["unread"], 0)
        db.path = original_path

    def test_failed_hf_files_download_creates_notification(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory, patch.object(settings, "hf_home", directory):
            db.path = Path(directory) / "download-notify.db"
            db.initialize()
            job_id = db.create_job("huggingface.files.download", "org/model")
            payload = main_module.HfFilesDownloadRequest(repo_id="org/model", files=["model-Q4_K_M.gguf"])
            with patch.object(main_module, "hf_hub_download", side_effect=OSError(28, "No space left on device")):
                asyncio.run(main_module.download_hf_files(job_id, payload))
            job = db.rows("SELECT status,message FROM jobs WHERE id=?", (job_id,))[0]
            self.assertEqual(job["status"], "failed")
            self.assertIn("Sin espacio en disco", job["message"])
            notice = db.rows("SELECT kind,title,message FROM notifications")
            self.assertEqual(notice[0]["kind"], "download.failed")
            self.assertIn("org/model", notice[0]["message"])
        db.path = original_path

    def test_unclean_shutdown_is_detected_only_after_a_reboot_without_clean_stop(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "shutdown.db"
            db.initialize()
            with patch("backend.main.current_boot_id", return_value="boot-a"):
                self.assertFalse(main_module.detect_unclean_shutdown_on_startup())
                self.assertFalse(main_module.detect_unclean_shutdown_on_startup())
                main_module.mark_clean_stop()
            with patch("backend.main.current_boot_id", return_value="boot-b"):
                self.assertFalse(main_module.detect_unclean_shutdown_on_startup())
            with patch("backend.main.current_boot_id", return_value="boot-c"):
                self.assertTrue(main_module.detect_unclean_shutdown_on_startup())
            notices = db.rows("SELECT kind,level FROM notifications")
            self.assertEqual([(item["kind"], item["level"]) for item in notices], [("system.unclean_shutdown", "warning")])
        db.path = original_path

    def test_nvme_unsafe_shutdown_counter_growth_creates_notification(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "nvme.db"
            db.initialize()
            device = lambda count: [{"name": "nvme0", "model": "SSD X", "smart": {"unsafe_shutdowns": count}}]
            self.assertEqual(main_module.record_nvme_unsafe_shutdowns(device(16)), [])
            self.assertEqual(main_module.record_nvme_unsafe_shutdowns(device(16)), [])
            self.assertEqual(main_module.record_nvme_unsafe_shutdowns(device(18)), ["nvme0"])
            self.assertEqual(main_module.record_nvme_unsafe_shutdowns([{"name": "nvme0", "model": "SSD X", "smart": {}}]), [])
            notices = db.rows("SELECT kind,message FROM notifications")
            self.assertEqual(len(notices), 1)
            self.assertEqual(notices[0]["kind"], "storage.nvme.unsafe_shutdown")
            self.assertIn("2 apagado(s)", notices[0]["message"])
        db.path = original_path

    def test_fwupd_updates_are_parsed_with_release_notes_and_reboot_flag(self) -> None:
        payload = json.dumps({"Devices": [
            {"DeviceId": "ec1", "Name": "Embedded Controller", "Vendor": "NVIDIA", "Version": "3.13.7",
             "Flags": ["updatable", "needs-reboot"],
             "Releases": [{"Version": "3.14.0", "Summary": "EC firmware", "Description": "<p>Fixes</p><ul><li>Fan curve</li></ul>"}]},
            {"DeviceId": "ssd", "Name": "SSD", "Version": "1.0", "Flags": ["updatable"], "Releases": []},
        ]})
        updates = main_module.parse_fwupd_updates(payload)
        self.assertEqual(len(updates), 1)
        self.assertEqual((updates[0]["current_version"], updates[0]["new_version"]), ("3.13.7", "3.14.0"))
        self.assertTrue(updates[0]["needs_reboot"])
        self.assertEqual(updates[0]["description"], "Fixes\n• Fan curve")

    def test_fwupd_reboot_pending_uses_update_state_not_capability_flag(self) -> None:
        capability_only = json.dumps({"Devices": [{"Flags": ["needs-reboot"], "UpdateState": 2}]})
        staged = json.dumps({"Devices": [{"Flags": ["needs-reboot"], "UpdateState": 4}]})
        self.assertFalse(main_module.fwupd_reboot_pending(capability_only))
        self.assertTrue(main_module.fwupd_reboot_pending(staged))
        self.assertFalse(main_module.fwupd_reboot_pending("not json"))

    def test_connectx_status_reports_missing_cable_pending_and_current(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = root / "firmware-metadata.json"
            metadata.write_text(json.dumps([{"Name": "ConnectX-7", "PackageVersion": "28.50.1002"}]))
            net = root / "net"
            (net / "enP7s7" / "device").mkdir(parents=True)
            self.assertEqual(main_module.connectx_firmware_status(metadata, net)["state"], "cable_required")
            driver = root / "drivers" / "mlx5_core"
            driver.mkdir(parents=True)
            (net / "enp1s0f0np0" / "device").mkdir(parents=True)
            (net / "enp1s0f0np0" / "device" / "driver").symlink_to(driver)
            for running, expected in (("28.45.1200", "pending"), ("28.50.1002", "current")):
                output = subprocess.CompletedProcess([], 0, f"driver: mlx5_core\nfirmware-version: {running} (NVD0000000033)\n", "")
                with patch("backend.main.shutil.which", return_value="/usr/sbin/ethtool"), \
                     patch("backend.main.run_command", return_value=output):
                    status = main_module.connectx_firmware_status(metadata, net)
                self.assertEqual((status["running_version"], status["state"]), (running, expected))
            self.assertIsNone(main_module.connectx_firmware_status(root / "missing.json", net))

    def test_new_firmware_is_notified_once_per_version(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "firmware.db"
            db.initialize()
            status = lambda version: {"updates": [{"device_id": "ec1", "name": "Embedded Controller", "new_version": version}], "connectx": None}
            self.assertEqual(main_module.notify_new_firmware(status("3.14.0")), ["ec1:3.14.0"])
            self.assertEqual(main_module.notify_new_firmware(status("3.14.0")), [])
            self.assertEqual(main_module.notify_new_firmware(status("3.15.0")), ["ec1:3.15.0"])
            notices = db.rows("SELECT kind FROM notifications")
            self.assertEqual([item["kind"] for item in notices], ["system.firmware.available"] * 2)
        db.path = original_path

    def test_firmware_apply_requires_firmware_switch_and_no_running_jobs(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "firmware-apply.db"
            db.initialize()
            request = main_module.FirmwareUpdateRequest(confirm="ACTUALIZAR FIRMWARE")
            with patch.object(settings, "enable_firmware_updates", False):
                with self.assertRaises(HTTPException) as disabled:
                    asyncio.run(main_module.apply_firmware_updates(request, main_module.BackgroundTasks()))
            self.assertEqual(disabled.exception.status_code, 403)
            job_id = db.create_job("huggingface.download", "org/model")
            db.update_job(job_id, "running", 10, "descargando")
            with patch.object(settings, "enable_firmware_updates", True), \
                 patch("backend.main.shutil.which", return_value="/usr/bin/fwupdmgr"):
                with self.assertRaises(HTTPException) as busy:
                    asyncio.run(main_module.apply_firmware_updates(request, main_module.BackgroundTasks()))
            self.assertEqual(busy.exception.status_code, 409)
        db.path = original_path

    def test_failed_hf_download_cleanup_keeps_previous_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(settings, "hf_home", directory):
            repo = Path(directory) / "hub" / "models--org--model"
            snapshot = repo / "snapshots" / "abc"
            blobs = repo / "blobs"
            snapshot.mkdir(parents=True)
            blobs.mkdir()
            (blobs / "old").write_bytes(b"old")
            (snapshot / "README.md").symlink_to(blobs / "old")
            before = main_module.hf_snapshot_entries("org/model")
            (blobs / "new").write_bytes(b"new")
            (snapshot / "model-00001-of-00002.gguf").symlink_to(blobs / "new")
            (blobs / "partial.incomplete").write_bytes(b"x")
            removed = main_module.discard_failed_hf_download("org/model", before)
            self.assertEqual(removed, 2)
            self.assertTrue((snapshot / "README.md").exists())
            self.assertFalse((blobs / "new").exists())
            self.assertFalse((blobs / "partial.incomplete").exists())

            fresh = Path(directory) / "hub" / "models--org--fresh"
            (fresh / "blobs").mkdir(parents=True)
            (fresh / "blobs" / "x.incomplete").write_bytes(b"x")
            main_module.discard_failed_hf_download("org/fresh", set())
            self.assertFalse(fresh.exists())

    def test_benchmark_failure_marks_model_health(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory, patch.object(settings, "hf_home", directory):
            db.path = Path(directory) / "health.db"
            db.initialize()
            model = {"model_repo": "org/model-GGUF", "model_filename": "model-Q4_K_M.gguf"}
            self.assertTrue(main_module.benchmark_failure_blames_model("RuntimeError: exiting due to model loading error", False))
            self.assertFalse(main_module.benchmark_failure_blames_model("RuntimeError: No hay puertos locales libres", True))
            self.assertEqual(main_module.mark_model_health_from_benchmark(model, "model loading error", "job"), "defective")
            self.assertEqual(main_module.mark_model_health_from_benchmark(model, "tensor data is not within the file bounds", "job"), "incomplete")
            self.assertEqual(main_module.model_health_marks()["org/model-gguf"]["status"], "incomplete")
            main_module.clear_model_health("org/model-GGUF", "other.gguf")
            self.assertIn("org/model-gguf", main_module.model_health_marks())
            main_module.clear_model_health("org/model-GGUF", "model-Q4_K_M.gguf")
            self.assertNotIn("org/model-gguf", main_module.model_health_marks())
            main_module.mark_model_health_from_benchmark(model, "model loading error", "job")
            main_module.mark_model_healthy("org/model-GGUF", "model-Q4_K_M.gguf", "job2")
            healthy = main_module.model_health_marks()["org/model-gguf"]
            self.assertEqual((healthy["status"], healthy["file"], healthy["job_id"]), ("healthy", "model-Q4_K_M.gguf", "job2"))
            self.assertEqual(main_module.mark_model_health_from_benchmark(model, "model loading error", "job3"), "defective")
            main_module.mark_model_healthy("", "x.gguf", "job4")
            self.assertEqual(set(main_module.model_health_marks()), {"org/model-gguf"})
            files = [
                {"name": "mmproj-model-BF16.gguf", "complete": True},
                {"name": "Model-DSpark-Q8_0.gguf", "complete": True},
            ]
            self.assertEqual(main_module.local_hf_health("org/drafter-only", files, {})["status"], "incomplete")
        db.path = original_path

    def test_benchmark_history_marks_healthy_only_when_latest_run_is_valid(self) -> None:
        rows = [
            {"source_id": "Org/Good-GGUF", "filename": "good.gguf", "job_id": "j1", "valid": 0, "at": "2026-11-19T10:00:00"},
            {"source_id": "Org/Good-GGUF", "filename": "good.gguf", "job_id": "j2", "valid": 1, "at": "2026-11-20T10:00:00"},
            {"source_id": "org/broken-GGUF", "filename": "b.gguf", "job_id": "j3", "valid": 1, "at": "2026-11-19T10:00:00"},
            {"source_id": "org/broken-GGUF", "filename": "b.gguf", "job_id": "j4", "valid": 0, "at": "2026-11-20T10:00:00"},
        ]
        with patch.object(main_module.db, "rows", return_value=rows):
            marks = main_module.benchmark_health_marks()
        self.assertEqual(set(marks), {"org/good-gguf"})
        self.assertEqual((marks["org/good-gguf"]["status"], marks["org/good-gguf"]["job_id"]), ("healthy", "j2"))

    def test_benchmark_health_is_queried_per_source(self) -> None:
        rows = [{"source_id": "llama3.2:3b", "filename": "", "job_id": "j9", "valid": 1, "at": "2026-11-20T10:00:00"}]
        with patch.object(main_module.db, "rows", return_value=rows) as query:
            marks = main_module.benchmark_source_health("ollama")
        self.assertEqual(query.call_args.args[1], ("ollama",))
        self.assertEqual(marks["llama3.2:3b"]["status"], "healthy")

    def test_profile_apps_listing_refreshes_status_and_skips_busy_apps(self) -> None:
        codes = {"ragkit": 0, "stopped-app": 3}
        calls: list[tuple[str, str]] = []

        async def fake_action(name: str, action: str) -> int:
            calls.append((name, action))
            return codes[name]

        async def scenario() -> dict[str, object]:
            busy = asyncio.Lock()
            await busy.acquire()
            with patch.dict(main_module._profile_app_locks, {"busy-app": busy}, clear=True), \
                    patch.dict(main_module._profile_app_state, {}, clear=True):
                main_module.set_profile_app_state("busy-app", "starting", "start.sh start manual")
                result = await main_module.list_profile_apps()
                return {"states": {name: dict(state) for name, state in result["states"].items()}}

        with patch.object(main_module, "discover_profile_apps", return_value=["busy-app", "ragkit", "stopped-app"]), \
                patch.object(main_module, "run_profile_app_action", side_effect=fake_action), \
                patch.object(main_module, "profile_app_web_configs", return_value={}):
            result = asyncio.run(scenario())
        states = result["states"]
        self.assertEqual(sorted(calls), [("ragkit", "status"), ("stopped-app", "status")])
        self.assertEqual(states["ragkit"]["state"], "running")
        self.assertEqual(states["stopped-app"]["state"], "stopped")
        self.assertEqual(states["busy-app"]["state"], "starting")

    def test_huggingface_favorites_are_persisted(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "favorites.db"
            model = SimpleNamespace(
                id="org/model-heretic-GGUF",
                downloads=123,
                likes=7,
                pipeline_tag="text-generation",
                tags=["gguf", "chat"],
                siblings=[],
                private=False,
                gated=False,
                last_modified=datetime(2026, 11, 11, tzinfo=timezone.utc),
            )
            with (
                patch("backend.main.HfApi") as api,
                TestClient(app) as client,
            ):
                api.return_value.model_info.return_value = model
                saved = client.put("/api/models/huggingface/favorites", json={
                    "repo_id": "org/model-heretic-GGUF",
                    "enabled": True,
                })
                self.assertEqual(saved.status_code, 200)
                favorites = client.get("/api/models/huggingface/favorites").json()
                self.assertEqual(favorites[0]["id"], "org/model-heretic-GGUF")
                self.assertEqual(favorites[0]["downloads"], 123)
                self.assertGreater(favorites[0]["community_score"], 0)
                self.assertTrue(favorites[0]["uncensored"])
                self.assertIn("recommended_score", favorites[0])
                removed = client.put("/api/models/huggingface/favorites", json={
                    "repo_id": "org/model-heretic-GGUF",
                    "enabled": False,
                })
                self.assertEqual(removed.json()["count"], 0)
        db.path = original_path

    def test_huggingface_filters_work_without_search_text(self) -> None:
        model = SimpleNamespace(
            id="org/popular-coder",
            downloads=1000,
            likes=50,
            trending_score=12,
            pipeline_tag="text-generation",
            tags=["code", "text-generation", "heretic"],
            private=False,
            gated=False,
            last_modified=datetime(2026, 11, 11, tzinfo=timezone.utc),
        )
        with (
            patch("backend.main.HfApi") as api,
            TestClient(app) as client,
        ):
            api.return_value.list_models.side_effect = [[model], [model]]
            api.return_value.model_info.return_value = model
            response = client.get(
                "/api/models/huggingface/search",
                params={"q": "", "task": "code"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id"], "org/popular-coder")
        self.assertTrue(response.json()[0]["uncensored"])
        self.assertIn("recommended_score", response.json()[0])
        self.assertIn("recommendation_status", response.json()[0])
        for call in api.return_value.list_models.call_args_list:
            self.assertNotIn("search", call.kwargs)

    def test_profile_can_persist_multiple_models(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "multi.db"
            with TestClient(app) as client:
                response = client.post("/api/profiles", json={
                    "name": "Grupo local",
                    "engine": "llama.cpp",
                    "model_ref": "primary",
                    "model_file": "/models/primary.gguf",
                    "port": 18080,
                    "port_auto": False,
                    "additional_models": [{
                        "name": "Segundo",
                        "engine": "llama.cpp",
                        "model_ref": "second",
                        "model_file": "/models/second.gguf",
                        "port": 18081,
                        "port_auto": False,
                        "context_size": 16384,
                        "estimated_memory_mb": 12288,
                    }],
                })
                self.assertEqual(response.status_code, 200)
                profile_id = response.json()["id"]
                listing = client.get("/api/profiles").json()["profiles"]
                profile = next(item for item in listing if item["id"] == profile_id)
                self.assertEqual(len(profile["models"]), 2)
                self.assertEqual(profile["models"][1]["port"], 18081)
                self.assertGreater(profile["memory_plan"]["required_mb"], 0)
                self.assertIn("fits", profile["runtime_plan"])
                self.assertIn(profile_id, profile["runtime_plan"]["profile_ids"])
        db.path = original_path

    def test_profile_can_be_duplicated_with_another_name_and_its_own_ports(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory, \
                patch("backend.main.local_port_available", return_value=True):
            db.path = Path(directory) / "duplicate.db"
            with TestClient(app) as client:
                created = client.post("/api/profiles", json={
                    "name": "Original", "engine": "llama.cpp", "model_ref": "primary",
                    "model_repo": "org/Model-GGUF", "model_filename": "Model-00001-of-00002.gguf",
                    "model_files": ["Model-00001-of-00002.gguf", "Model-00002-of-00002.gguf"],
                    "port": 18080, "port_auto": False, "temperature": 0.3, "context_size": 32768,
                    "additional_models": [
                        {"name": "Segundo", "engine": "llama.cpp", "model_ref": "second",
                         "model_file": "/models/second.gguf", "port": 18081, "port_auto": False},
                        {"name": "Ollama", "engine": "ollama", "model_ref": "qwen3:8b", "port": 11434},
                    ],
                })
                self.assertEqual(created.status_code, 200, created.json())
                source_id = created.json()["id"]
                copy = client.post(f"/api/profiles/{source_id}/duplicate", json={"name": "Original copia"})
                self.assertEqual(copy.status_code, 200, copy.json())
                again = client.post(f"/api/profiles/{source_id}/duplicate", json={"name": "original COPIA"})
                self.assertEqual(again.status_code, 409)
                missing = client.post("/api/profiles/no-existe/duplicate", json={"name": "Otro"})
                self.assertEqual(missing.status_code, 404)
                listing = {item["id"]: item for item in client.get("/api/profiles").json()["profiles"]}
        db.path = original_path
        source, duplicate = listing[source_id], listing[copy.json()["id"]]
        self.assertEqual(duplicate["name"], "Original copia")
        self.assertEqual(duplicate["temperature"], 0.3)
        self.assertEqual(duplicate["context_size"], 32768)
        self.assertEqual(duplicate["model_files"], source["model_files"])
        self.assertEqual(len(duplicate["model_files"]), 2)
        self.assertEqual([item["name"] for item in duplicate["models"]], ["Original copia", "Segundo", "Ollama"])
        self.assertFalse(duplicate["active"])
        llama_ports = {item["port"] for item in source["models"] if item["engine"] == "llama.cpp"}
        copy_ports = {item["port"] for item in duplicate["models"] if item["engine"] == "llama.cpp"}
        self.assertFalse(llama_ports & copy_ports)
        self.assertEqual(duplicate["models"][2]["port"], 11434)

    def test_local_model_is_added_to_a_profile_with_its_launch_config(self) -> None:
        original_path = db.path
        launch = {
            "engine": "llama.cpp", "model_ref": "org/Coder-GGUF", "model_alias": "primary",
            "model_repo": "org/Coder-GGUF", "model_filename": "Coder-Q4_K_M.gguf",
            "model_files": ["Coder-Q4_K_M.gguf"], "context_size": 65536, "temperature": 0.6,
            "estimated_memory_mb": 9000, "port": 4321,
        }
        with tempfile.TemporaryDirectory() as directory, \
                patch("backend.main.local_port_available", return_value=True), \
                patch("backend.main.managed_model_config", new=AsyncMock(return_value=launch)) as config:
            db.path = Path(directory) / "add-model.db"
            with TestClient(app) as client:
                created = client.post("/api/profiles", json={
                    "name": "Trabajo", "engine": "llama.cpp", "model_ref": "primary",
                    "model_file": "/models/primary.gguf", "port": 18080, "port_auto": False,
                })
                profile_id = created.json()["id"]
                body = {"source": "huggingface", "model_id": "org/Coder-GGUF", "context_size": 65536}
                added = client.post(f"/api/profiles/{profile_id}/models", json=body)
                self.assertEqual(added.status_code, 200, added.json())
                again = client.post(f"/api/profiles/{profile_id}/models", json=body)
                missing = client.post("/api/profiles/no-existe/models", json=body)
                managed = client.post(f"/api/profiles/{main_module.QUICK_PROFILE_ID}/models", json=body)
                profile = next(item for item in client.get("/api/profiles").json()["profiles"] if item["id"] == profile_id)
        db.path = original_path
        config.assert_awaited_once_with("huggingface", "org/Coder-GGUF", 65536)
        self.assertEqual((again.status_code, missing.status_code, managed.status_code), (409, 404, 403))
        self.assertFalse(added.json()["running"])
        primary, coder = profile["models"]
        self.assertEqual(primary["port"], 18080)
        self.assertEqual(coder["model_filename"], "Coder-Q4_K_M.gguf")
        self.assertEqual(coder["context_size"], 65536)
        self.assertEqual(coder["temperature"], 0.6)
        self.assertEqual(coder["model_alias"], "primary-2")
        self.assertNotIn(coder["port"], {18080, 4321})

    def test_profile_ports_are_reassigned_when_another_runtime_uses_them(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "managed-ports.db"
            with TestClient(app) as client:
                ids = []
                for name, model in (("Primero", "first"), ("Segundo", "second")):
                    response = client.post("/api/profiles", json={
                        "name": name,
                        "engine": "llama.cpp",
                        "model_ref": model,
                        "model_file": f"/models/{model}.gguf",
                        "model_alias": model,
                        "port": 18080,
                        "port_auto": False,
                    })
                    self.assertEqual(response.status_code, 200)
                    ids.append(response.json()["id"])
            rows = [
                db.rows("SELECT * FROM profiles WHERE id=?", (profile_id,))[0]
                for profile_id in ids
            ]
            with (
                patch("backend.main.local_port_available", return_value=True),
                patch("backend.main.persistent_models", return_value=[]),
            ):
                managed, assignments = main_module.managed_profile_ports(rows[1], [rows[0]])
            self.assertEqual(managed["port"], 18081)
            self.assertEqual(assignments[0]["from"], 18080)
            self.assertEqual(assignments[0]["to"], 18081)
        db.path = original_path

    def test_automatic_ports_never_overlap_other_profiles_or_each_other(self) -> None:
        original_path = db.path
        try:
            with tempfile.TemporaryDirectory() as directory, \
                    patch("backend.main.local_port_available", side_effect=lambda port: port != 18081):
                db.path = Path(directory) / "auto-ports.db"
                with TestClient(app) as client:
                    def create(name: str, extra: list[dict[str, Any]]) -> dict[str, Any]:
                        response = client.post("/api/profiles", json={
                            "name": name, "engine": "llama.cpp", "model_ref": name.casefold(),
                            "model_file": f"/models/{name}.gguf", "additional_models": extra,
                        })
                        self.assertEqual(response.status_code, 200, response.text)
                        listing = client.get("/api/profiles").json()["profiles"]
                        return next(item for item in listing if item["id"] == response.json()["id"])

                    first = create("Uno", [])
                    second = create("Dos", [
                        {"name": "Dos B", "engine": "llama.cpp", "model_ref": "dos-b", "model_file": "/models/b.gguf"},
                        {"name": "Dos C", "engine": "llama.cpp", "model_ref": "dos-c", "model_file": "/models/c.gguf", "port": 18080},
                    ])
                    first_ports = [model["port"] for model in first["models"]]
                    second_ports = [model["port"] for model in second["models"]]
                    others = {
                        model["port"]
                        for item in client.get("/api/profiles").json()["profiles"]
                        if item["id"] != second["id"]
                        for model in item["models"]
                    }
                    self.assertEqual(len(set(second_ports)), 3)
                    self.assertFalse(others.intersection(second_ports))
                    self.assertIn(first_ports[0], others)
                    self.assertNotIn(18081, [*first_ports, *second_ports])
                    self.assertTrue(all(port in main_module.AUTO_MODEL_PORTS for port in [*first_ports, *second_ports]))
                    self.assertTrue(first["port_auto"])

                    edited = {key: second[key] for key in ("name", "engine", "model_ref", "model_file", "port", "port_auto")}
                    edited["additional_models"] = [
                        {key: model[key] for key in ("name", "engine", "model_ref", "model_file", "port", "port_auto")}
                        for model in second["models"][1:]
                    ]
                    with patch("backend.main.local_port_available", return_value=False):
                        response = client.put(f"/api/profiles/{second['id']}", json=edited)
                    self.assertEqual(response.status_code, 200, response.text)
                    again = next(item for item in client.get("/api/profiles").json()["profiles"] if item["id"] == second["id"])
                    # Its own ports stay even while its running models hold them.
                    self.assertEqual([model["port"] for model in again["models"]], second_ports)
        finally:
            db.path = original_path

    def test_profile_rejects_duplicate_aliases_case_insensitively(self) -> None:
        payload = ProfilePayload(
            name="Alias repetidos",
            engine="llama.cpp",
            model_ref="primary",
            model_file="/models/primary.gguf",
            model_alias="Coder",
            port=18080,
            additional_models=[main_module.AdditionalModelPayload(
                id="second",
                name="Segundo",
                engine="llama.cpp",
                model_ref="second",
                model_file="/models/second.gguf",
                model_alias="coder",
                port=18081,
            )],
        )
        with self.assertRaisesRegex(HTTPException, "alias OpenAI distinto"):
            main_module.validate_profile(payload)

    def test_tts_lab_profile_requires_a_local_project_endpoint(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "tts-lab.db"
            payload = {
                "name": "TTS Lab local",
                "engine": "openai-compatible",
                "model_ref": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
                "model_alias": "tts-paramita",
                "port": 18010,
                "task": "tts",
                "input_modalities": ["text"],
                "output_modalities": ["audio"],
                "runtime_backend": "external",
                "endpoint_url": "http://127.0.0.1:8010/api/projects/paramita",
                "api_protocol": "tts-lab",
            }
            with TestClient(app) as client:
                created = client.post("/api/profiles", json=payload)
                invalid = client.post(
                    "/api/profiles",
                    json={
                        **payload,
                        "name": "TTS Lab sin proyecto",
                        "endpoint_url": "http://127.0.0.1:8010",
                    },
                )
                listing = client.get("/api/profiles").json()["profiles"]
            self.assertEqual(created.status_code, 200)
            self.assertEqual(invalid.status_code, 400)
            profile = next(item for item in listing if item["id"] == created.json()["id"])
            self.assertEqual(profile["api_protocol"], "tts-lab")
            self.assertEqual(profile["task"], "tts")
        db.path = original_path

    def test_persistent_models_form_a_read_only_default_profile(self) -> None:
        original_path = db.path
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "persistent.db"
                with TestClient(app) as client:
                    save_persistent_models([
                        persistent_model_config("ollama", "global-model:latest"),
                        persistent_model_config("ollama", "embed-model:latest"),
                    ])
                    listing = client.get("/api/profiles").json()["profiles"]
                    default = next(item for item in listing if item["id"] == main_module.DEFAULT_PROFILE_ID)
                    others = [item for item in listing if item["id"] != main_module.DEFAULT_PROFILE_ID]
                    self.assertEqual(default["name"], "Default")
                    self.assertTrue(default["read_only"])
                    self.assertEqual(
                        [model["model_ref"] for model in default["models"]],
                        ["global-model:latest", "embed-model:latest"],
                    )
                    self.assertFalse(any(
                        model["model_ref"] == "global-model:latest"
                        for profile in others for model in profile["models"]
                    ))
                    edit = client.put(f"/api/profiles/{main_module.DEFAULT_PROFILE_ID}", json={
                        "name": "Otro", "engine": "ollama", "model_ref": "x", "port": 18080,
                    })
                    delete = client.delete(
                        f"/api/profiles/{main_module.DEFAULT_PROFILE_ID}", params={"confirm": "Default"},
                    )
                    activate = client.post(f"/api/profiles/{main_module.DEFAULT_PROFILE_ID}/activate")
                    self.assertEqual({edit.status_code, delete.status_code, activate.status_code}, {403})
                    save_persistent_models([])
                    self.assertFalse(db.rows("SELECT id FROM profiles WHERE id=?", (main_module.DEFAULT_PROFILE_ID,)))
        finally:
            db.path = original_path

    def test_uncensored_flag_reads_card_header_but_not_body(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "models--peculiar-ragdoll--Cyber-Tiel"
            snapshot = repo / "snapshots" / "abc"
            snapshot.mkdir(parents=True)
            readme = snapshot / "README.md"
            readme.write_text("---\nbase_model:\n- huihui-ai/Ornith-abliterated\n---\nCoder.\n", encoding="utf-8")
            header = main_module.hf_card_front_matter(repo, [{"commit": "abc"}])
            self.assertTrue(main_module.UNCENSORED_MODEL_PATTERN.search(header))
            readme.write_text("---\ntags:\n- gguf\n---\nUnlike uncensored models it keeps safety rails.\n", encoding="utf-8")
            header = main_module.hf_card_front_matter(repo, [{"commit": "abc"}])
            self.assertIsNone(main_module.UNCENSORED_MODEL_PATTERN.search(header))
            readme.unlink()
            self.assertEqual(main_module.hf_card_front_matter(repo, [{"commit": "abc"}]), "")

    def test_stop_all_models_keeps_chat_and_default_but_stops_the_rest(self) -> None:
        original_path = db.path
        unloaded: list[str] = []

        async def launch(profile: dict[str, Any], model: dict[str, Any], context: int, runtime_key: str) -> None:
            main_module._external_model_ids.add(runtime_key)
            main_module._runtime_model_signatures[runtime_key] = main_module.model_runtime_signature(model, context)
            main_module._runtime_model_routes[runtime_key] = {"port": model["port"], "model_alias": model["model_alias"]}

        async def stop_process(runtime_key: str) -> None:
            main_module._external_model_ids.discard(runtime_key)
            main_module._runtime_model_signatures.pop(runtime_key, None)
            main_module._runtime_model_routes.pop(runtime_key, None)

        async def ollama(path: str, method: str = "GET", body: Any = None, **_: Any) -> dict[str, Any]:
            if path == "/api/ps":
                return {"models": [{"name": "alpha:latest"}, {"name": "chat:latest"}]}
            if path == "/api/generate":
                unloaded.append(str((body or {}).get("model")))
                return {}
            return {"models": [{"name": "alpha:latest", "size": 1024**3}, {"name": "chat:latest"}]}

        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "stop-all.db"
                with (
                    patch("backend.main.launch_profile_model", new=launch),
                    patch("backend.main.stop_model_process", new=stop_process),
                    patch("backend.main.ollama_payload", new=ollama),
                    patch("backend.main.resolved_assistant_reference", new=AsyncMock(return_value="chat:latest")),
                    patch("backend.main.boot_restore_runtime", new=AsyncMock()),
                    patch("backend.main.psutil.virtual_memory", return_value=SimpleNamespace(
                        total=128 * 1024**3, available=120 * 1024**3, used=8 * 1024**3, percent=6.0,
                    )),
                    TestClient(app) as client,
                ):
                    started = client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "alpha:latest"})
                    self.assertEqual(started.status_code, 200, started.text)
                    response = client.post("/api/models/stop-all")
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()
                    self.assertEqual(result["stopped_profiles"], ["Quick"])
                    self.assertEqual(result["released_ollama"], ["alpha:latest"])
                    self.assertEqual(unloaded, ["alpha:latest"])
                    self.assertNotIn(main_module.QUICK_PROFILE_ID, main_module._runtime_profile_ids)
                    self.assertEqual(main_module.managed_models(main_module.QUICK_PROFILE_ID), [])
        finally:
            db.path = original_path

    def test_comfyui_release_route_frees_memory_and_reports_failures(self) -> None:
        async def freed() -> None:
            main_module._comfyui_freed_at = time.time()

        with (
            patch("backend.main.comfyui_loaded_model_files", new=AsyncMock(return_value={"qwen_image_2.1_bf16.safetensors"})),
            patch("backend.main.release_comfyui_models", new=freed),
            patch("backend.main.boot_restore_runtime", new=AsyncMock()),
            TestClient(app) as client,
        ):
            response = client.post("/api/models/comfyui/release")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["models"], ["qwen_image_2.1_bf16.safetensors"])
        main_module._comfyui_freed_at = 0.0
        with (
            patch("backend.main.comfyui_loaded_model_files", new=AsyncMock(return_value=set())),
            patch("backend.main.release_comfyui_models", new=AsyncMock()),
            patch("backend.main.boot_restore_runtime", new=AsyncMock()),
            TestClient(app) as client,
        ):
            self.assertEqual(client.post("/api/models/comfyui/release").status_code, 502)

    def test_models_report_whether_encender_fits_with_what_is_loaded(self) -> None:
        original_path = db.path
        gb = 1024**3

        async def launch(profile: dict[str, Any], model: dict[str, Any], context: int, runtime_key: str) -> None:
            main_module._external_model_ids.add(runtime_key)
            main_module._runtime_model_signatures[runtime_key] = main_module.model_runtime_signature(model, context)
            main_module._runtime_model_routes[runtime_key] = {"port": model["port"], "model_alias": model["model_alias"]}

        async def stop_process(runtime_key: str) -> None:
            main_module._external_model_ids.discard(runtime_key)
            main_module._runtime_model_signatures.pop(runtime_key, None)
            main_module._runtime_model_routes.pop(runtime_key, None)

        async def ollama(path: str, *_: Any, **__: Any) -> dict[str, Any]:
            if path == "/api/ps":
                return {"models": []}
            return {"models": [
                {"name": "small:latest", "size": 2 * gb, "digest": "a"},
                {"name": "medium:latest", "size": 30 * gb, "digest": "b"},
                {"name": "huge:latest", "size": 200 * gb, "digest": "c"},
            ]}

        def by_name(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
            return {item["name"]: item for item in payload["ollama"]}

        main_module._quick_config_cache.clear()
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "fits.db"
                with (
                    patch("backend.main.launch_profile_model", new=launch),
                    patch("backend.main.stop_model_process", new=stop_process),
                    patch("backend.main.ollama_payload", new=ollama),
                    patch("backend.main.local_hf_models", return_value=[]),
                    patch("backend.main.comfyui_loaded_model_files", new=AsyncMock(return_value=set())),
                    patch("backend.main.whisper_loaded_runtime_models", new=AsyncMock(return_value=[])),
                    patch("backend.main.resolved_assistant_reference", new=AsyncMock(return_value=None)),
                    patch("backend.main.boot_restore_runtime", new=AsyncMock()),
                    patch("backend.main.psutil.virtual_memory", return_value=SimpleNamespace(
                        total=128 * gb, available=20 * gb, used=108 * gb, percent=84.0,
                    )),
                    TestClient(app) as client,
                ):
                    before = by_name(client.get("/api/models").json())
                    self.assertTrue(before["small:latest"]["quick_start"]["fits"])
                    self.assertTrue(before["medium:latest"]["quick_start"]["fits"])
                    self.assertFalse(before["huge:latest"]["quick_start"]["fits"])
                    self.assertIn("en total", before["huge:latest"]["quick_start"]["reason"])

                    started = client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "small:latest"})
                    self.assertEqual(started.status_code, 200, started.text)
                    after = by_name(client.get("/api/models").json())
                    self.assertNotIn("quick_start", after["small:latest"])
                    self.assertFalse(after["medium:latest"]["quick_start"]["fits"])
                    self.assertIn("libres", after["medium:latest"]["quick_start"]["reason"])
                    refused = client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "medium:latest"})
                    self.assertEqual(refused.status_code, 409)

                    client.post("/api/models/quick/stop", json={"source": "ollama", "model_id": "small:latest"})
                    freed = by_name(client.get("/api/models").json())
                    self.assertTrue(freed["medium:latest"]["quick_start"]["fits"])
        finally:
            db.path = original_path
            main_module._quick_config_cache.clear()

    def test_quick_model_starts_now_stops_alone_and_survives_only_service_restarts(self) -> None:
        original_path = db.path
        launched: list[str] = []
        stopped: list[str] = []

        async def launch(profile: dict[str, Any], model: dict[str, Any], context: int, runtime_key: str) -> None:
            launched.append(model["model_ref"])
            main_module._external_model_ids.add(runtime_key)
            main_module._runtime_model_signatures[runtime_key] = main_module.model_runtime_signature(model, context)
            main_module._runtime_model_routes[runtime_key] = {"port": model["port"], "model_alias": model["model_alias"]}

        async def stop_process(runtime_key: str) -> None:
            stopped.append(runtime_key)
            main_module._external_model_ids.discard(runtime_key)
            main_module._runtime_model_signatures.pop(runtime_key, None)
            main_module._runtime_model_routes.pop(runtime_key, None)

        async def installed(path: str, *_: Any, **__: Any) -> dict[str, Any]:
            return {"models": [{"name": "alpha:latest"}, {"name": "beta:latest"}]}

        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "quick.db"
                with (
                    patch("backend.main.launch_profile_model", new=launch),
                    patch("backend.main.stop_model_process", new=stop_process),
                    patch("backend.main.ollama_payload", new=installed),
                    patch("backend.main.boot_restore_runtime", new=AsyncMock()),
                    patch("backend.main.psutil.virtual_memory", return_value=SimpleNamespace(
                        total=128 * 1024**3, available=120 * 1024**3, used=8 * 1024**3, percent=6.0,
                    )),
                    TestClient(app) as client,
                ):
                    first = client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "alpha:latest"})
                    second = client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "beta:latest"})
                    again = client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "beta:latest"})
                    self.assertEqual(
                        (first.status_code, second.status_code, again.status_code), (200, 200, 409),
                        (first.json(), second.json()),
                    )
                    self.assertEqual(launched, ["alpha:latest", "beta:latest"])
                    self.assertIn(main_module.QUICK_PROFILE_ID, main_module._runtime_profile_ids)
                    self.assertNotIn(main_module.QUICK_PROFILE_ID, main_module.desired_profile_ids() or [])
                    quick = next(
                        item for item in client.get("/api/profiles").json()["profiles"]
                        if item["id"] == main_module.QUICK_PROFILE_ID
                    )
                    self.assertTrue(quick["read_only"])
                    self.assertEqual(quick["name"], "Quick")
                    quick_rows = db.rows("SELECT * FROM profiles WHERE id=?", (main_module.QUICK_PROFILE_ID,))
                    self.assertEqual(
                        [item["name"] for item in main_module.profile_models(quick_rows[0])],
                        ["alpha latest", "beta latest"],
                    )
                    stop_alpha = client.post("/api/models/quick/stop", json={"source": "ollama", "model_id": "alpha:latest"})
                    self.assertEqual(stop_alpha.status_code, 200)
                    self.assertEqual(len(stopped), 1)
                    self.assertEqual(launched, ["alpha:latest", "beta:latest"])
                    client.post("/api/models/quick/stop", json={"source": "ollama", "model_id": "beta:latest"})
                    self.assertNotIn(main_module.QUICK_PROFILE_ID, main_module._runtime_profile_ids)
                    self.assertFalse(db.rows("SELECT id FROM profiles WHERE id=?", (main_module.QUICK_PROFILE_ID,)))
                    client.post("/api/models/quick/start", json={"source": "ollama", "model_id": "alpha:latest"})
                quick_row = ("SELECT id FROM profiles WHERE id=?", (main_module.QUICK_PROFILE_ID,))
                self.assertEqual(len(main_module.managed_models(main_module.QUICK_PROFILE_ID)), 1)
                marker = Path(directory) / ".quick-reset"
                with (
                    patch.object(main_module, "QUICK_RESET_MARKER", marker),
                    patch.object(settings, "enable_profile_autostart", True),
                ):
                    self.assertTrue(main_module.reconcile_quick_profile_on_startup())
                    self.assertTrue(db.rows(*quick_row))
                    marker.touch()
                    self.assertFalse(main_module.reconcile_quick_profile_on_startup())
                    self.assertFalse(marker.exists())
                    self.assertFalse(db.rows(*quick_row))
                    main_module.save_managed_models(main_module.QUICK_PROFILE_ID, [{"model_ref": "alpha:latest", "engine": "ollama", "model_alias": "alpha", "port": 30_001}])
                    with patch("backend.main.current_boot_id", return_value="otro-arranque"):
                        self.assertFalse(main_module.reconcile_quick_profile_on_startup())
                    self.assertEqual(main_module.managed_models(main_module.QUICK_PROFILE_ID), [])
        finally:
            db.path = original_path

    def test_artifex_profiles_are_seeded_once(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "artifex.db"
            db.initialize()
            seed_artifex_profiles()
            seed_artifex_profiles()
            profiles = db.rows("SELECT * FROM profiles WHERE id LIKE 'artifex-%' ORDER BY id")
            self.assertEqual(len(profiles), 6)
            qwen = next(item for item in profiles if item["id"] == "artifex-qwen-flash")
            self.assertEqual(qwen["context_size"], 262144)
            self.assertEqual(qwen["presence_penalty"], 1.5)
            self.assertEqual(qwen["active"], 0)
            self.assertEqual({item["runtime_requirement"] for item in profiles}, {main_module.LLAMA_CPP_RUNTIME})

            db.execute("UPDATE profiles SET runtime_requirement=? WHERE id='artifex-v7'", ("llama.cpp b10679 · CUDA 13 · sm_121 · tool calling",))
            db.execute("UPDATE profiles SET runtime_requirement=? WHERE id='artifex-gpt-oss'", ("Requiere llama.cpp b11429",))
            seed_artifex_profiles()
            self.assertEqual(db.rows("SELECT runtime_requirement FROM profiles WHERE id='artifex-v7'")[0]["runtime_requirement"], "llama.cpp v1.0.0 · CUDA 13 · sm_121 · tool calling")
            self.assertEqual(db.rows("SELECT runtime_requirement FROM profiles WHERE id='artifex-gpt-oss'")[0]["runtime_requirement"], "Requiere llama.cpp b11429")
        db.path = original_path

    def test_deleted_seed_profiles_are_not_seeded_again(self) -> None:
        original_path = db.path
        deleted = {"artifex-v8", "artifex-gpt-oss", "security-tools-bughunter-v8"}
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "seed-dismissed.db"
                db.initialize()
                seed_artifex_profiles()
                main_module.seed_default_profiles()
                for profile_id in sorted(deleted):
                    name = db.rows("SELECT name FROM profiles WHERE id=?", (profile_id,))[0]["name"]
                    asyncio.run(main_module.delete_profile(profile_id, confirm=name))
                seed_artifex_profiles()
                main_module.seed_default_profiles()
                remaining = {row["id"] for row in db.rows("SELECT id FROM profiles")}
                self.assertFalse(deleted & remaining)
                self.assertTrue((set(main_module.ARTIFEX_PROFILE_IDS) - deleted) <= remaining)
                self.assertIn("ragkit-paramita", remaining)
                self.assertEqual(main_module.dismissed_seed_profiles(), deleted)
        finally:
            db.path = original_path

    def test_recovered_default_profiles_are_seeded_once_without_overwriting(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "defaults.db"
            db.initialize()
            main_module.seed_default_profiles()
            main_module.seed_default_profiles()
            rows = db.rows(
                "SELECT id,name FROM profiles WHERE id NOT LIKE 'artifex-%' ORDER BY id"
            )
            self.assertEqual(len(rows), 8)
            self.assertIn("TTS Lab · Voces MLX", {row["name"] for row in rows})
            db.execute(
                "UPDATE profiles SET name=? WHERE id=?",
                ("TTS Lab personalizado", "tts-lab-mlx"),
            )
            main_module.seed_default_profiles()
            name = db.rows(
                "SELECT name FROM profiles WHERE id='tts-lab-mlx'"
            )[0]["name"]
            self.assertEqual(name, "TTS Lab personalizado")
        db.path = original_path

    def test_create_and_activate_profile(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "api.db"
            with TestClient(app) as client:
                response = client.post("/api/profiles", json={
                    "name": "Ollama principal",
                    "engine": "ollama",
                    "model_ref": "qwen3:8b",
                    "port": 11434,
                    "context_size": 16384,
                    "gpu_layers": -1,
                    "threads": 8,
                    "batch_size": 512,
                    "temperature": 0.6,
                    "top_p": 0.9,
                    "repeat_penalty": 1.1,
                    "flash_attention": True,
                })
                self.assertEqual(response.status_code, 200)
                profile_id = response.json()["id"]
                activated = client.post(f"/api/profiles/{profile_id}/activate")
                self.assertEqual(activated.status_code, 200)
                favorited = client.patch(
                    f"/api/profiles/{profile_id}/favorite",
                    json={"favorite": True},
                )
                self.assertEqual(favorited.status_code, 200)
                listing = client.get("/api/profiles").json()
                self.assertEqual(listing["profiles"][0]["active"], 1)
                self.assertEqual(listing["profiles"][0]["favorite"], 1)
        db.path = original_path

    def test_start_downloads_missing_hf_model_before_launching(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "prepare-start.db"
            model_path = Path(directory) / "model.gguf"

            def download(**_: object) -> str:
                model_path.write_bytes(b"valid gguf")
                return str(model_path)

            with (
                patch("backend.main.hf_hub_download", side_effect=download),
                patch(
                    "backend.main.start_profile_process",
                    new=AsyncMock(return_value={"running": True, "running_models": 1}),
                ) as launch,
                TestClient(app) as client,
            ):
                created = client.post("/api/profiles", json={
                    "name": "Perfil descargable",
                    "engine": "llama.cpp",
                    "model_ref": "demo",
                    "model_repo": "org/demo-GGUF",
                    "model_filename": "model.gguf",
                    "port": 18180,
                    "estimated_memory_mb": 1024,
                })
                profile_id = created.json()["id"]
                response = client.post(f"/api/profiles/{profile_id}/start")

                self.assertEqual(response.status_code, 200)
                job = db.rows("SELECT * FROM jobs WHERE id=?", (response.json()["job_id"],))[0]
                profile = db.rows("SELECT * FROM profiles WHERE id=?", (profile_id,))[0]
                self.assertEqual(job["status"], "completed")
                self.assertEqual(profile["active"], 1)
                self.assertEqual(Path(profile["model_file"]), model_path.resolve())
                launch.assert_awaited_once()
        db.path = original_path

    def test_download_failure_keeps_previous_profile_active_and_running(self) -> None:
        original_path = db.path
        original_runtime = main_module._runtime_profile_id
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "prepare-failure.db"
            with (
                patch(
                    "backend.main.download_hf_profile_file",
                    new=AsyncMock(side_effect=RuntimeError("descarga interrumpida")),
                ),
                patch("backend.main.stop_profile_process", new=AsyncMock()) as stop,
                patch("backend.main.start_profile_process", new=AsyncMock()) as launch,
                TestClient(app) as client,
            ):
                previous = client.post("/api/profiles", json={
                    "name": "Perfil estable",
                    "engine": "whisper",
                    "model_ref": "whisper",
                    "runtime_backend": "external",
                    "endpoint_url": "http://127.0.0.1:19000",
                    "task": "asr",
                    "input_modalities": ["audio"],
                    "output_modalities": ["text"],
                    "port": 19000,
                }).json()["id"]
                client.post(f"/api/profiles/{previous}/activate")
                main_module._runtime_profile_id = previous
                target = client.post("/api/profiles", json={
                    "name": "Perfil incompleto",
                    "engine": "llama.cpp",
                    "model_ref": "missing",
                    "model_repo": "org/missing-GGUF",
                    "model_filename": "missing.gguf",
                    "port": 18181,
                    "estimated_memory_mb": 1024,
                }).json()["id"]

                response = client.post(f"/api/profiles/{target}/start")
                job = db.rows("SELECT * FROM jobs WHERE id=?", (response.json()["job_id"],))[0]

                self.assertEqual(job["status"], "failed")
                self.assertEqual(db.rows("SELECT id FROM profiles WHERE active=1")[0]["id"], previous)
                stop.assert_not_awaited()
                launch.assert_not_awaited()
        main_module._runtime_profile_id = original_runtime
        db.path = original_path

    def test_profile_switch_reuses_identical_running_model(self) -> None:
        original_path = db.path
        original_runtime = main_module._runtime_profile_id
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "profile-reuse.db"
            with TestClient(app) as client:
                profile_ids = []
                for name in ("Perfil anterior", "Perfil nuevo"):
                    response = client.post("/api/profiles", json={
                        "name": name,
                        "engine": "whisper",
                        "model_ref": "whisper-large-v3",
                        "runtime_backend": "external",
                        "endpoint_url": "http://127.0.0.1:19000",
                        "task": "asr",
                        "input_modalities": ["audio"],
                        "output_modalities": ["text"],
                        "port": 19000,
                    })
                    self.assertEqual(response.status_code, 200)
                    profile_ids.append(response.json()["id"])
                previous = db.rows("SELECT * FROM profiles WHERE id=?", (profile_ids[0],))[0]
                target = db.rows("SELECT * FROM profiles WHERE id=?", (profile_ids[1],))[0]
                previous_model = main_module.profile_models(previous)[0]
                main_module._runtime_profile_id = previous["id"]
                main_module._external_model_ids.add("primary")
                main_module._runtime_effective_contexts["primary"] = previous_model["context_size"]
                main_module._runtime_model_signatures["primary"] = (
                    main_module.model_runtime_signature(
                        previous_model, previous_model["context_size"]
                    )
                )
                with patch(
                    "backend.main.launch_profile_model", new=AsyncMock()
                ) as launch:
                    runtime = asyncio.run(main_module.start_profile_process(target))
                self.assertEqual(runtime["reused_models"], 1)
                self.assertEqual(runtime["profile_id"], target["id"])
                launch.assert_not_awaited()
                self.assertIn("primary", main_module._external_model_ids)
                asyncio.run(main_module.stop_profile_process())
        main_module._runtime_profile_id = original_runtime
        db.path = original_path

    def test_two_profiles_share_one_identical_runtime_after_preflight(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "two-profiles.db"
            with TestClient(app) as client:
                profile_ids = []
                for name in ("Audio principal", "Audio secundario"):
                    response = client.post("/api/profiles", json={
                        "name": name,
                        "engine": "whisper",
                        "model_ref": "whisper-large-v3",
                        "model_alias": "transcribe",
                        "runtime_backend": "external",
                        "endpoint_url": "http://127.0.0.1:19000",
                        "task": "asr",
                        "input_modalities": ["audio"],
                        "output_modalities": ["text"],
                        "port": 19000,
                        "estimated_memory_mb": 1024,
                        "memory_reserve_mb": 1024,
                    })
                    self.assertEqual(response.status_code, 200)
                    profile_ids.append(response.json()["id"])
                profiles = [
                    db.rows("SELECT * FROM profiles WHERE id=?", (profile_id,))[0]
                    for profile_id in profile_ids
                ]

                async def launch(
                    _profile: dict[str, object],
                    model: dict[str, object],
                    context: int,
                    runtime_key: str,
                ) -> None:
                    main_module._external_model_ids.add(runtime_key)
                    main_module._runtime_effective_contexts[runtime_key] = context
                    main_module._runtime_model_signatures[runtime_key] = (
                        main_module.model_runtime_signature(model, context)
                    )

                with patch(
                    "backend.main.launch_profile_model", new=AsyncMock(side_effect=launch)
                ) as launched:
                    first = asyncio.run(main_module.start_profile_process(profiles[0]))
                    second = asyncio.run(main_module.start_profile_process(profiles[1]))
                self.assertEqual(launched.await_count, 1)
                self.assertEqual(second["profile_ids"], profile_ids)
                self.assertEqual(second["running_models"], 1)
                self.assertEqual(second["reused_models"], 1)
                self.assertTrue(all(model["shared"] for model in second["models"]))
                self.assertEqual(first["running_models"], 1)
                third_response = client.post("/api/profiles", json={
                    "name": "Audio tercero",
                    "engine": "whisper",
                    "model_ref": "whisper-large-v3",
                    "model_alias": "transcribe",
                    "runtime_backend": "external",
                    "endpoint_url": "http://127.0.0.1:19000",
                    "task": "asr",
                    "input_modalities": ["audio"],
                    "output_modalities": ["text"],
                    "port": 19000,
                    "estimated_memory_mb": 1024,
                    "memory_reserve_mb": 1024,
                })
                third = db.rows(
                    "SELECT * FROM profiles WHERE id=?",
                    (third_response.json()["id"],),
                )[0]
                with self.assertRaisesRegex(RuntimeError, "dos perfiles"):
                    asyncio.run(main_module.start_profile_process(third))
                asyncio.run(main_module.stop_runtime_profile(profile_ids[0]))
                after_first_stop = main_module.profile_runtime_status()
                self.assertEqual(after_first_stop["profile_ids"], [profile_ids[1]])
                self.assertEqual(after_first_stop["running_models"], 1)
                asyncio.run(main_module.stop_runtime_profile(profile_ids[1]))
                self.assertFalse(main_module.profile_runtime_status()["running"])
        db.path = original_path

    def test_multi_profile_preflight_rejects_ambiguous_alias(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "profile-alias-conflict.db"
            with TestClient(app) as client:
                profile_ids = []
                for index, endpoint in enumerate((
                    "http://127.0.0.1:19001",
                    "http://127.0.0.1:19002",
                )):
                    response = client.post("/api/profiles", json={
                        "name": f"Whisper {index}",
                        "engine": "whisper",
                        "model_ref": f"whisper-{index}",
                        "model_alias": "Transcribe" if index == 0 else "transcribe",
                        "runtime_backend": "external",
                        "endpoint_url": endpoint,
                        "task": "asr",
                        "input_modalities": ["audio"],
                        "output_modalities": ["text"],
                        "port": 19001 + index,
                        "estimated_memory_mb": 1024,
                        "memory_reserve_mb": 1024,
                    })
                    profile_ids.append(response.json()["id"])
                profiles = [
                    db.rows("SELECT * FROM profiles WHERE id=?", (profile_id,))[0]
                    for profile_id in profile_ids
                ]
                plan = main_module.profiles_runtime_plan(profiles)
                self.assertFalse(plan["fits"])
                self.assertEqual(plan["alias_conflicts"], ["transcribe"])
        db.path = original_path

    def test_external_audio_profile_exposes_multimodal_capabilities(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "multimodal.db"
            with TestClient(app) as client:
                response = client.post("/api/profiles", json={
                    "name": "Whisper local",
                    "engine": "whisper",
                    "model_ref": "whisper-large-v3",
                    "model_alias": "transcribe",
                    "task": "asr",
                    "input_modalities": ["audio"],
                    "output_modalities": ["text"],
                    "runtime_backend": "external",
                    "endpoint_url": "http://127.0.0.1:9000",
                    "port": 19000,
                })
                self.assertEqual(response.status_code, 200)
                profile_id = response.json()["id"]
                client.post(f"/api/profiles/{profile_id}/activate")
                profile = client.get("/api/profiles").json()["profiles"][0]
                capabilities = client.get("/api/multimodal/capabilities").json()
                self.assertEqual(profile["task"], "asr")
                self.assertEqual(profile["input_modalities"], ["audio"])
                self.assertEqual(capabilities["models"][0]["endpoint"], "/v1/audio/transcriptions")
        db.path = original_path

    def test_legacy_deployment_tables_are_dropped_and_routes_are_gone(self) -> None:
        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "legacy.db"
            try:
                with sqlite3.connect(db.path) as connection:
                    connection.executescript(
                        "CREATE TABLE deployments (id TEXT PRIMARY KEY);"
                        "CREATE TABLE deployment_versions (id TEXT PRIMARY KEY, deployment_id TEXT);"
                        "INSERT INTO deployments VALUES ('old');"
                    )
                db.initialize()
                tables = {row["name"] for row in db.rows("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertFalse({"deployments", "deployment_versions"} & tables)
                self.assertFalse([route for route in app.routes if "/api/deployments" in getattr(route, "path", "")])
            finally:
                db.path = original_path


class GatewayTests(unittest.TestCase):
    def test_litellm_adapter_reports_broken_entrypoint_as_unavailable(self) -> None:
        original_database_path = settings.database_path
        try:
            with tempfile.TemporaryDirectory() as directory:
                settings.database_path = str(Path(directory) / "mydgx.db")
                asyncio.run(litellm_adapter.stop())
                routes = {
                    "test-model": {
                        "engine": "ollama",
                        "model_ref": "test-model:latest",
                        "task": "chat",
                    },
                }
                with (
                    patch("backend.gateway.Path.is_file", return_value=True),
                    patch("backend.gateway.subprocess.Popen", side_effect=OSError("bad shebang")),
                ):
                    available = asyncio.run(litellm_adapter.ensure(routes))
                self.assertFalse(available)
                self.assertIsNone(litellm_adapter.process)
                self.assertIsNone(litellm_adapter.log_handle)
        finally:
            settings.database_path = original_database_path

    def test_gateway_routes_are_capability_aware(self) -> None:
        self.assertTrue(supports_endpoint({"task": "vision"}, "/v1/chat/completions"))
        self.assertTrue(supports_endpoint({"task": "asr"}, "/v1/audio/transcriptions"))
        self.assertFalse(supports_endpoint({"task": "chat"}, "/v1/images/generations"))
        self.assertTrue(supports_gateway_protocol(
            {"api_protocol": "openai"}, "/v1/chat/completions"
        ))
        self.assertFalse(supports_gateway_protocol(
            {"api_protocol": "ragkit"}, "/v1/chat/completions"
        ))
        self.assertTrue(supports_gateway_protocol(
            {"api_protocol": "tts-lab"}, "/v1/audio/speech"
        ))
        self.assertTrue(supports_gateway_protocol(
            {"api_protocol": "comfyui"}, "/v1/images/generations"
        ))

    def test_gateway_adapts_managed_comfyui_image_to_openai(self) -> None:
        model = {
            "id": "comfyui-image",
            "engine": "comfyui",
            "model_ref": "flux.safetensors",
            "model_alias": "comfyui-image",
            "api_protocol": "comfyui",
            "task": "image-generation",
        }
        with (
            patch(
                "backend.gateway.loaded_routes",
                new=AsyncMock(return_value=({"id": "managed-comfyui"}, {"comfyui-image": model})),
            ),
            patch(
                "backend.gateway.execute_multimodal_request",
                new=AsyncMock(return_value={
                    "content_type": "image/png",
                    "data_base64": "iVBORw0KGgo=",
                }),
            ),
            TestClient(gateway_app) as gateway,
        ):
            response = gateway.post("/v1/images/generations", json={
                "model": "comfyui-image",
                "prompt": "A green cube",
                "n": 1,
                "response_format": "b64_json",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["b64_json"], "iVBORw0KGgo=")

    def test_gateway_network_binding_requires_key(self) -> None:
        original_path = db.path
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "gateway-config.db"
            with TestClient(app) as client:
                response = client.put("/api/gateway/config", json={
                    "enabled": True,
                    "host": "0.0.0.0",
                    "port": 4000,
                    "request_timeout_seconds": 600,
                    "max_request_mb": 32,
                })
            self.assertEqual(response.status_code, 400)
        settings.gateway_api_key = original_key
        db.path = original_path

    def test_gateway_web_search_is_on_by_default_and_filters_results(self) -> None:
        original_path = db.path
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        captured: dict[str, Any] = {}

        class FakeResponse:
            status_code = 200

            def json(self) -> dict[str, Any]:
                return {
                    "results": [
                        {"title": "<b>Spark</b>", "url": "https://example.com/a", "content": "hola  <i>mundo</i>"},
                        {"title": "local", "url": "http://127.0.0.1/secret", "content": "no"},
                        {"title": "lan", "url": "http://10.1.1.1/x", "content": "no"},
                        {"title": "ok", "url": "https://docs.example.org/b", "content": "segundo"},
                    ]
                }

        class FakeClient:
            def __init__(self, *_args: Any, **kwargs: Any) -> None:
                captured["kwargs"] = kwargs

            async def __aenter__(self) -> "GatewayTests.FakeClient":
                return self

            async def __aexit__(self, *_args: Any) -> bool:
                return False

            async def get(self, url: str, params: Any = None) -> Any:
                captured["url"] = url
                captured["params"] = params
                return FakeResponse()

        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "search.db"
                with TestClient(app) as client:
                    config = client.get("/api/gateway/config")
                    self.assertEqual(config.status_code, 200)
                    self.assertTrue(config.json()["web_search"])
                with patch("backend.gateway.httpx.AsyncClient", FakeClient), TestClient(gateway_app) as gateway:
                    self.assertTrue(gateway.get("/health").json()["web_search"])
                    response = gateway.post("/v1/search", json={"query": "  dgx   spark  ", "limit": 9})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(captured["params"]["q"], "dgx spark")
                self.assertEqual(captured["params"]["format"], "json")
                self.assertFalse(captured["kwargs"]["follow_redirects"])
                self.assertTrue(captured["url"].endswith("/search"))
                body = response.json()
                self.assertEqual(
                    [item["url"] for item in body["results"]],
                    ["https://example.com/a", "https://docs.example.org/b"],
                )
                self.assertEqual(body["results"][0]["title"], "Spark")
                self.assertEqual(body["results"][0]["snippet"], "hola mundo")
                self.assertNotIn("query", body)
                self.assertNotIn("127.0.0.1", response.text)
                with TestClient(app) as client:
                    saved = client.put("/api/gateway/config", json={
                        "enabled": True,
                        "host": "127.0.0.1",
                        "port": 4000,
                        "request_timeout_seconds": 600,
                        "max_request_mb": 32,
                        "web_search": False,
                    })
                    self.assertEqual(saved.status_code, 200)
                    self.assertFalse(client.get("/api/gateway/config").json()["web_search"])
                with TestClient(gateway_app) as gateway:
                    self.assertFalse(gateway.get("/health").json()["web_search"])
                    denied = gateway.post("/v1/search", json={"query": "secreto-que-no-debe-loguearse"})
                self.assertEqual(denied.status_code, 403)
                self.assertNotIn("secreto-que-no-debe-loguearse", denied.text)
        finally:
            settings.gateway_api_key = original_key
            db.path = original_path

    def test_gateway_web_search_hides_upstream_failures(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None

        class FakeClient:
            def __init__(self, *_args: Any, **_kwargs: Any) -> None:
                pass

            async def __aenter__(self) -> "GatewayTests.FakeClient":
                return self

            async def __aexit__(self, *_args: Any) -> bool:
                return False

            async def get(self, *_args: Any, **_kwargs: Any) -> Any:
                raise httpx.ConnectError("http://127.0.0.1:8888/search?q=secreto-interno")

        try:
            with (
                patch("backend.gateway.gateway_runtime_config", return_value={
                    "enabled": True,
                    "host": "127.0.0.1",
                    "port": 4000,
                    "request_timeout_seconds": 600,
                    "max_request_mb": 32,
                    "web_search": True,
                }),
                patch("backend.gateway.httpx.AsyncClient", FakeClient),
                TestClient(gateway_app) as gateway,
            ):
                response = gateway.post("/v1/search", json={"query": "secreto-interno"})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("secreto-interno", response.text)
            self.assertEqual(response.json()["error"]["code"], "search_unavailable")
        finally:
            settings.gateway_api_key = original_key

    def test_gateway_errors_default_to_english_and_follow_the_requested_language(self) -> None:
        with (
            patch("backend.gateway.gateway_runtime_config", return_value={
                "enabled": False,
                "host": "127.0.0.1",
                "port": 4000,
                "request_timeout_seconds": 600,
                "max_request_mb": 32,
                "web_search": False,
            }),
            TestClient(gateway_app) as gateway,
        ):
            default = gateway.get("/v1/models")
            spanish = gateway.get("/v1/models", headers={"Accept-Language": "es-ES,es;q=0.9"})
            explicit = gateway.get("/v1/models", headers={"Accept-Language": "es", "X-MyDGX-Language": "en"})
            anthropic = gateway.post("/v1/messages", json={}, headers={"X-MyDGX-Language": "es"})
        self.assertEqual(default.status_code, 503)
        self.assertEqual(default.json()["error"]["message"], "Gateway disabled")
        self.assertEqual(default.json()["error"]["code"], "gateway_unavailable")
        self.assertEqual(spanish.json()["error"]["message"], "Gateway desactivado")
        self.assertEqual(explicit.json()["error"]["message"], "Gateway disabled")
        self.assertEqual(anthropic.json()["error"]["message"], "Gateway desactivado")
        self.assertEqual(anthropic.json()["type"], "error")

    def test_opencode_enables_searxng_tool_without_storing_the_key(self) -> None:
        import importlib.util

        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location(
            "opencode_workspace_under_test", root / "scripts" / "opencode_workspace.py"
        )
        self.assertIsNotNone(spec and spec.loader)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        model = {"id": "model", "context": 65536, "tools": True, "reasoning": False, "vision": False}
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            (workspace / ".opencode").mkdir()
            path = module.write_config(
                workspace, "http://127.0.0.1:14000/v1", [model], model, False, "1.2.3", True,
            )
            config = json.loads(path.read_text(encoding="utf-8"))
            encoded = json.dumps(config)
            self.assertIn("searxng", config["mcp"])
            self.assertNotIn("playwright", config["mcp"])
            self.assertEqual(config["tools"]["websearch"], False)
            self.assertEqual(config["tools"]["webfetch"], False)
            self.assertEqual(config["permission"]["websearch"], "deny")
            self.assertEqual(config["permission"]["searxng_*"], "allow")
            self.assertEqual(config["agent"]["plan"]["permission"]["searxng_*"], "allow")
            environment = config["mcp"]["searxng"]["environment"]
            self.assertEqual(environment["MYDGX_GATEWAY_API_KEY"], "{env:MYDGX_GATEWAY_API_KEY}")
            self.assertEqual(environment["MYDGX_GATEWAY_URL"], "http://127.0.0.1:14000/v1")
            self.assertTrue(str(config["mcp"]["searxng"]["command"][1]).endswith("opencode_searxng_mcp.py"))
            self.assertNotIn("local-mydgx-gateway", encoded)
            disabled = module.write_config(
                workspace, "http://127.0.0.1:14000/v1", [model], model, False, "1.2.3", False,
            )
            self.assertNotIn("mcp", json.loads(disabled.read_text(encoding="utf-8")))

    def test_claude_code_enables_searxng_without_storing_the_key(self) -> None:
        import importlib.util
        import sys

        root = Path(__file__).resolve().parents[1]
        scripts = str(root / "scripts")
        sys.path.insert(0, scripts)
        try:
            spec = importlib.util.spec_from_file_location(
                "claude_code_workspace_under_test", root / "scripts" / "claude_code_workspace.py"
            )
            module = importlib.util.module_from_spec(spec)
            assert spec is not None and spec.loader is not None
            spec.loader.exec_module(module)
            model = {"id": "model", "context": 65536, "tools": True, "reasoning": False, "vision": False}
            with tempfile.TemporaryDirectory() as directory:
                workspace = Path(directory)
                settings = module.write_config(workspace, "http://127.0.0.1:14000/v1", model, False, True)
                mcp_path = module.write_mcp(workspace, "http://127.0.0.1:14000/v1", False, True)
                config = json.loads(settings.read_text(encoding="utf-8"))
                mcp = json.loads(mcp_path.read_text(encoding="utf-8"))
                encoded = json.dumps({"settings": config, "mcp": mcp})
                self.assertIn("mcp__searxng", config["permissions"]["allow"])
                self.assertIn("WebSearch", config["permissions"]["deny"])
                self.assertIn("WebFetch", config["permissions"]["deny"])
                self.assertNotIn("playwright", mcp["mcpServers"])
                server = mcp["mcpServers"]["searxng"]
                self.assertEqual(server["env"]["MYDGX_GATEWAY_URL"], "http://127.0.0.1:14000/v1")
                self.assertEqual(server["env"]["MYDGX_GATEWAY_API_KEY"], "${MYDGX_GATEWAY_API_KEY}")
                self.assertTrue(str(server["args"][0]).endswith("opencode_searxng_mcp.py"))
                self.assertNotIn("local-mydgx-gateway", encoded)
                self.assertNotIn("sk-", encoded)
                self.assertIsNone(module.write_mcp(workspace, "http://127.0.0.1:14000/v1", False, False))
                disabled = json.loads(
                    module.write_config(workspace, "http://127.0.0.1:14000/v1", model, False, False).read_text(encoding="utf-8")
                )
                self.assertNotIn("mcp__searxng", disabled["permissions"]["allow"])
        finally:
            if scripts in sys.path:
                sys.path.remove(scripts)

    def test_searxng_mcp_returns_snippets_and_fixed_errors(self) -> None:
        import importlib.util
        import io
        import os
        import urllib.error
        import urllib.request

        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location(
            "opencode_searxng_mcp_under_test", root / "scripts" / "opencode_searxng_mcp.py"
        )
        module = importlib.util.module_from_spec(spec)
        assert spec is not None and spec.loader is not None
        spec.loader.exec_module(module)

        class FakeResponse(io.BytesIO):
            def __enter__(self) -> "GatewayTests.FakeResponse":
                return self

            def __exit__(self, *_args: Any) -> bool:
                return False

        def fake_urlopen(request: urllib.request.Request, timeout: int = 0) -> FakeResponse:
            self.assertEqual(request.full_url, "http://127.0.0.1:14000/v1/search")
            self.assertEqual(request.get_header("Authorization"), "Bearer local-test-key")
            self.assertIn(b"dgx spark", request.data or b"")
            self.assertNotIn(b"local-test-key", request.data or b"")
            return FakeResponse(json.dumps({
                "results": [{"title": "Uno", "url": "https://example.com", "snippet": "dato"}],
            }).encode())

        environment = {
            "MYDGX_GATEWAY_URL": "http://127.0.0.1:14000/v1",
            "MYDGX_GATEWAY_API_KEY": "local-test-key",
        }
        with patch.dict(os.environ, environment), patch.object(module.urllib.request, "urlopen", fake_urlopen):
            text = module.gateway_search("dgx spark")
        self.assertIn("https://example.com", text)
        self.assertNotIn("local-test-key", text)

        def unavailable(request: urllib.request.Request, timeout: int = 0) -> Any:
            raise urllib.error.HTTPError(request.full_url, 503, "no", {}, None)

        with patch.dict(os.environ, environment), patch.object(module.urllib.request, "urlopen", unavailable):
            failure = module.gateway_search("super-secret")
        self.assertEqual(failure, "Búsqueda no disponible.")
        self.assertNotIn("super-secret", failure)
        listed = module.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        self.assertEqual(listed["result"]["tools"][0]["name"], "web_search")

    def test_gateway_lists_only_loaded_models_from_active_profile(self) -> None:
        original_path = db.path
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        with tempfile.TemporaryDirectory() as directory:
            db.path = Path(directory) / "gateway.db"
            with TestClient(app) as client:
                created = client.post("/api/profiles", json={
                    "name": "Proxy local",
                    "engine": "llama.cpp",
                    "model_ref": "internal-model",
                    "model_alias": "public-model",
                    "model_file": "/models/model.gguf",
                    "port": 18080,
                })
                profile_id = created.json()["id"]
                client.post(f"/api/profiles/{profile_id}/activate")
            with patch("backend.gateway.model_is_healthy", new=AsyncMock(return_value=True)):
                with TestClient(gateway_app) as gateway:
                    response = gateway.get("/v1/models")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"][0]["id"], "public-model")
            self.assertEqual(response.json()["data"][0]["context_length"], 8192)
        settings.gateway_api_key = original_key
        db.path = original_path

    def test_gateway_lists_models_from_both_running_profiles(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        profiles = [{"id": "profile-a"}, {"id": "profile-b"}]
        models = {
            "profile-a": [{
                "id": "primary", "name": "Chat", "engine": "llama.cpp",
                "model_ref": "chat-internal", "model_alias": "chat-public",
                "port": 18080, "task": "chat",
            }],
            "profile-b": [{
                "id": "primary", "name": "Audio", "engine": "whisper",
                "model_ref": "whisper-large-v3", "model_alias": "transcribe",
                "endpoint_url": "http://127.0.0.1:9000", "task": "asr",
                "input_modalities": ["audio"], "output_modalities": ["text"],
            }],
        }
        with (
            patch("backend.gateway.running_profiles", return_value=profiles),
            patch(
                "backend.gateway.running_profile_models",
                side_effect=lambda profile: models[profile["id"]],
            ),
            patch("backend.gateway.model_is_healthy", new=AsyncMock(return_value=True)),
            TestClient(gateway_app) as gateway,
        ):
            response = gateway.get("/v1/models")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["id"] for item in response.json()["data"]},
            {"chat-public", "transcribe"},
        )
        settings.gateway_api_key = original_key

    def test_gateway_publishes_model_capabilities(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        base = {"id": "primary", "name": "Modelo", "engine": "llama.cpp", "port": 18080}
        routes = {
            "coder": {**base, "model_ref": "coder", "task": "chat", "jinja": 1, "reasoning_off": 0},
            "no-jinja": {**base, "model_ref": "no-jinja", "task": "chat", "jinja": 0, "reasoning_off": 1},
            "eyes": {
                **base, "model_ref": "eyes", "task": "vision", "jinja": 1, "reasoning_off": 1,
                "input_modalities": ["text", "image"],
            },
            "external": {
                "id": "ext", "name": "Externo", "engine": "vllm", "model_ref": "external",
                "task": "chat", "endpoint_url": "http://127.0.0.1:8000",
            },
            "embed": {**base, "model_ref": "embed", "task": "embeddings", "jinja": 1, "reasoning_off": 0},
        }
        with (
            patch(
                "backend.gateway.loaded_routes",
                new=AsyncMock(return_value=({"id": "profile"}, routes)),
            ),
            TestClient(gateway_app) as gateway,
        ):
            listed = {item["id"]: item["capabilities"] for item in gateway.get("/v1/models").json()["data"]}
            single = gateway.get("/v1/models/eyes").json()["capabilities"]
        settings.gateway_api_key = original_key
        self.assertEqual(listed["coder"], {"tools": True, "reasoning": True, "vision": False})
        self.assertEqual(listed["no-jinja"], {"tools": False, "reasoning": False, "vision": False})
        self.assertEqual(listed["eyes"], {"tools": True, "reasoning": False, "vision": True})
        self.assertEqual(listed["external"], {"tools": True, "reasoning": False, "vision": False})
        self.assertEqual(listed["embed"], {"tools": False, "reasoning": False, "vision": False})
        self.assertEqual(single, listed["eyes"])

    def test_gateway_requires_bearer_key_and_rewrites_public_alias(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = "test-only-placeholder"
        model = {
            "id": "primary", "name": "Modelo", "engine": "llama.cpp",
            "model_ref": "internal-model", "model_alias": "public-model", "port": 18080,
        }
        upstream = httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}]},
            request=httpx.Request("POST", "http://127.0.0.1:18080/v1/chat/completions"),
        )
        with patch(
            "backend.gateway.loaded_routes",
            new=AsyncMock(return_value=({"id": "profile"}, {"public-model": model})),
        ), patch("httpx.AsyncClient.send", new=AsyncMock(return_value=upstream)) as send:
            with TestClient(gateway_app) as gateway:
                denied = gateway.post("/v1/chat/completions", json={"model": "public-model", "messages": []})
                allowed = gateway.post(
                    "/v1/chat/completions",
                    headers={"Authorization": "Bearer test-only-placeholder"},
                    json={"model": "public-model", "messages": []},
                )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)
        forwarded = json.loads(send.await_args.args[0].content)
        self.assertEqual(forwarded["model"], "public-model")
        settings.gateway_api_key = original_key

    def test_gateway_accepts_anthropic_api_key_header(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = "test-only-placeholder"
        with patch(
            "backend.gateway.loaded_routes",
            new=AsyncMock(return_value=({"id": "profile"}, {})),
        ):
            with TestClient(gateway_app) as gateway:
                response = gateway.get(
                    "/v1/models",
                    headers={"x-api-key": "test-only-placeholder"},
                )
        self.assertEqual(response.status_code, 200)
        settings.gateway_api_key = original_key

    def test_litellm_adapter_maps_local_runtimes_without_secrets(self) -> None:
        config = litellm_adapter._config({
            "llama-local": {
                "engine": "llama.cpp", "model_ref": "internal", "model_alias": "llama-local",
                "port": 18080, "task": "chat", "api_protocol": "openai",
            },
            "ollama-local": {
                "engine": "ollama", "model_ref": "qwen3:8b", "model_alias": "ollama-local",
                "port": 11434, "task": "chat", "api_protocol": "ollama",
            },
            "private-api": {
                "engine": "openai-compatible", "model_ref": "private", "model_alias": "private-api",
                "port": 19000, "task": "chat", "api_protocol": "ragkit",
                "endpoint_url": "http://127.0.0.1:9000",
            },
        })
        self.assertEqual(
            [item["model_name"] for item in config["model_list"]],
            ["llama-local", "ollama-local"],
        )
        encoded = json.dumps(config)
        self.assertIn("http://127.0.0.1:18080/v1", encoded)
        self.assertNotIn("private-api", encoded)

    def test_gateway_proxies_anthropic_messages_through_litellm(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        model = {
            "engine": "llama.cpp", "model_ref": "internal", "model_alias": "public-model",
            "port": 18080, "task": "chat", "api_protocol": "openai",
        }
        upstream = httpx.Response(
            200,
            json={
                "id": "msg_local", "type": "message", "role": "assistant",
                "content": [{"type": "text", "text": "ok"}],
                "model": "public-model", "stop_reason": "end_turn",
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
            request=httpx.Request("POST", "http://127.0.0.1:4001/v1/messages"),
        )
        with patch(
            "backend.gateway.loaded_routes",
            new=AsyncMock(return_value=({"id": "profile"}, {"public-model": model})),
        ), patch.object(
            litellm_adapter, "ensure", new=AsyncMock(return_value=True)
        ), patch(
            "httpx.AsyncClient.send", new=AsyncMock(return_value=upstream)
        ) as send:
            with TestClient(gateway_app) as gateway:
                response = gateway.post(
                    "/v1/messages",
                    headers={"anthropic-version": "2023-06-01"},
                    json={
                        "model": "public-model", "max_tokens": 32,
                        "messages": [{"role": "user", "content": "hola"}],
                    },
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["type"], "message")
        self.assertEqual(str(send.await_args.args[0].url), "http://127.0.0.1:4001/v1/messages")
        settings.gateway_api_key = original_key

    def test_gateway_streams_responses_api_from_litellm(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        model = {
            "engine": "llama.cpp", "model_ref": "internal", "model_alias": "public-model",
            "port": 18080, "task": "chat", "api_protocol": "openai",
        }
        class EventStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'data: {"type":"response.completed"}\n\n'

        upstream = httpx.Response(
            200,
            stream=EventStream(),
            headers={"content-type": "text/event-stream", "x-request-id": "req-local"},
            request=httpx.Request("POST", "http://127.0.0.1:4001/v1/responses"),
        )
        with patch(
            "backend.gateway.loaded_routes",
            new=AsyncMock(return_value=({"id": "profile"}, {"public-model": model})),
        ), patch.object(
            litellm_adapter, "ensure", new=AsyncMock(return_value=True)
        ), patch(
            "httpx.AsyncClient.send", new=AsyncMock(return_value=upstream)
        ):
            with TestClient(gateway_app) as gateway:
                response = gateway.post(
                    "/v1/responses",
                    json={"model": "public-model", "input": "hola", "stream": True},
                )
        self.assertEqual(response.status_code, 200)
        self.assertIn("response.completed", response.text)
        self.assertEqual(response.headers.get("x-request-id"), "req-local")
        settings.gateway_api_key = original_key

    def test_gateway_proxies_audio_multipart_by_capability(self) -> None:
        original_key = settings.gateway_api_key
        settings.gateway_api_key = None
        model = {
            "id": "primary", "name": "Whisper", "engine": "whisper",
            "model_ref": "whisper-large-v3", "model_alias": "transcribe",
            "task": "asr", "endpoint_url": "http://127.0.0.1:9000",
        }
        upstream = httpx.Response(
            200,
            json={"text": "hola"},
            request=httpx.Request("POST", "http://127.0.0.1:9000/v1/audio/transcriptions"),
        )
        captured: dict[str, object] = {}

        async def send_request(request: httpx.Request, **_: object) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["content"] = request.read()
            return upstream

        with patch(
            "backend.gateway.loaded_routes",
            new=AsyncMock(return_value=({"id": "profile"}, {"transcribe": model})),
        ), patch("httpx.AsyncClient.send", new=AsyncMock(side_effect=send_request)):
            with TestClient(gateway_app) as gateway:
                response = gateway.post(
                    "/v1/audio/transcriptions",
                    data={"model": "transcribe"},
                    files={"file": ("sample.wav", b"WAVE", "audio/wav")},
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured["url"], "http://127.0.0.1:9000/v1/audio/transcriptions")
        self.assertIn(b"whisper-large-v3", captured["content"])
        settings.gateway_api_key = original_key


class ReviewRegressionTests(unittest.TestCase):
    def test_browser_requests_from_other_sites_and_rebound_hosts_are_rejected(self) -> None:
        client = TestClient(app)
        path = "/api/jobs/missing-job/cancel"
        self.assertEqual(client.post(path, headers={"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(client.post(path, headers={"Sec-Fetch-Site": "cross-site"}).status_code, 403)
        self.assertEqual(client.get("/api/health", headers={"Host": "evil.example:8088"}).status_code, 403)
        self.assertNotEqual(client.post(path, headers={"Origin": "http://testserver"}).status_code, 403)
        self.assertNotEqual(client.post(path, headers={"Origin": "http://localhost:5173"}).status_code, 403)
        self.assertNotEqual(client.post(path).status_code, 403)
        self.assertEqual(client.get("/api/health", headers={"Sec-Fetch-Site": "cross-site"}).status_code, 200)

        gateway = TestClient(gateway_app)
        response = gateway.post("/v1/chat/completions", json={}, headers={"Origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(gateway.get("/health", headers={"Host": "attacker.example"}).status_code, 403)

    def test_progress_updates_do_not_undo_a_requested_cancellation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Database(str(Path(directory) / "jobs.db"))
            database.initialize()
            job_id = database.create_job("huggingface.files.download", "org/model")
            database.update_job(job_id, "running", 10, "Descargando")
            database.request_job_cancel(job_id)
            database.update_job(job_id, "running", 50, "Descargando")
            self.assertEqual(database.rows("SELECT status,progress FROM jobs")[0], {"status": "cancelling", "progress": 50})
            database.update_job(job_id, "cancelled", 50, "Descarga cancelada")
            self.assertEqual(database.rows("SELECT status FROM jobs")[0]["status"], "cancelled")

    def test_context_auto_fit_never_goes_below_the_configured_minimum(self) -> None:
        profile = {"auto_fit_context": 1, "minimum_context_size": 12000}
        model = {"engine": "llama.cpp", "context_size": 16384}
        self.assertEqual(context_attempts(profile, model), [16384, 12000])

    def test_gateway_process_reads_the_runtime_published_by_the_dashboard(self) -> None:
        original_path = db.path
        try:
            with tempfile.TemporaryDirectory() as directory:
                db.path = Path(directory) / "runtime.db"
                db.initialize()
                with (
                    patch.object(main_module, "_runtime_profile_ids", ["coder"]),
                    patch.object(main_module, "_runtime_profile_models", {"coder": {"primary": "coder-key"}}),
                    patch.object(main_module, "_runtime_model_routes", {"coder-key": {"port": 18090, "model_alias": "coder"}}),
                    patch.object(main_module, "_runtime_effective_contexts", {"coder-key": 32768}),
                ):
                    main_module.publish_runtime_snapshot()
                main_module.use_published_runtime()
                try:
                    profile_ids, mappings, routes, contexts = main_module.runtime_state()
                finally:
                    main_module.use_published_runtime(False)
        finally:
            db.path = original_path
        self.assertEqual(profile_ids, ["coder"])
        self.assertEqual(mappings["coder"], {"primary": "coder-key"})
        self.assertEqual(routes["coder-key"]["port"], 18090)
        self.assertEqual(contexts["coder-key"], 32768)

    def test_stop_requested_during_start_invalidates_the_start_marker(self) -> None:
        before = main_module.runtime_stop_marker("coder")
        with patch.object(main_module, "_runtime_profile_models", {}), patch.object(main_module, "_runtime_profile_ids", []):
            asyncio.run(main_module.stop_runtime_profile("coder"))
        self.assertNotEqual(main_module.runtime_stop_marker("coder"), before)
        self.assertEqual(main_module.runtime_stop_marker("other")[1], 0)

    def test_huggingface_model_used_by_a_loaded_profile_cannot_be_deleted(self) -> None:
        with (
            patch("backend.main.resolved_assistant_reference", new=AsyncMock(return_value=None)),
            patch("backend.main.running_profiles", return_value=[{"id": "coder", "name": "Coder"}]),
            patch("backend.main.running_profile_models", return_value=[{"model_repo": "Org/Model-GGUF"}]),
            patch("backend.main.shutil.rmtree") as rmtree,
            TestClient(app) as client,
        ):
            response = client.delete("/api/models/huggingface/org/model-GGUF", params={"confirm": "org/model-GGUF"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("Coder", response.json()["detail"])
        rmtree.assert_not_called()


FAKE_APP_SCRIPT = """#!/usr/bin/env bash
case "$1" in
  start) env > env.txt; touch running; echo start >> calls.txt ;;
  stop) rm -f running; echo stop >> calls.txt ;;
  status) [ -f running ] ;;
esac
"""


class ProfileAppTests(unittest.TestCase):
    def make_app(self, root: Path, name: str = "demo") -> Path:
        directory = root / "apps" / name
        directory.mkdir(parents=True)
        (directory / "start.sh").write_text(FAKE_APP_SCRIPT, encoding="utf-8")
        (directory / "start.sh").chmod(0o755)
        return directory

    def test_only_own_apps_with_start_script_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = self.make_app(root)
            (root / "apps" / "no-script").mkdir()
            (root / "apps" / "link").symlink_to(app)
            self.make_app(root, f"{main_module.ROOT.resolve().name}.deploy-backup")
            with patch.object(settings, "profile_apps_root", str(root / "apps")), patch.object(settings, "profile_apps", ""):
                self.assertEqual(main_module.discover_profile_apps(), ["demo"])
                self.assertIsNone(main_module.profile_app_dir("../demo"))
                (app / "start.sh").chmod(0o777)
                self.assertIsNone(main_module.profile_app_dir("demo"))
                (app / "start.sh").chmod(0o755)
                with patch.object(settings, "profile_apps", "otra"):
                    self.assertIsNone(main_module.profile_app_dir("demo"))

    def test_app_follows_profiles_and_stops_with_the_last_one(self) -> None:
        async def scenario(app: Path) -> None:
            main_module.schedule_profile_app({"id": "p1", "app": "demo"})
            await main_module._profile_app_tasks["p1"]
            self.assertTrue((app / "running").exists())
            main_module.schedule_profile_app({"id": "p2", "app": "demo"})
            await main_module._profile_app_tasks["p2"]
            await main_module.release_profile_app("p1")
            self.assertTrue((app / "running").exists())
            await main_module.release_profile_app("p2")
            self.assertFalse((app / "running").exists())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = self.make_app(root)
            with (
                patch.object(settings, "profile_apps_root", str(root / "apps")),
                patch.object(settings, "profile_apps", ""),
                patch.object(main_module, "ROOT", root),
                patch.object(main_module.db, "log"),
                patch.dict(main_module.os.environ, {"HF_TOKEN": "test-placeholder"}),
            ):
                asyncio.run(scenario(app))
            self.assertEqual((app / "calls.txt").read_text().split(), ["start", "stop"])
            self.assertNotIn("HF_TOKEN", (app / "env.txt").read_text())
            self.assertIn("MYDGX_GATEWAY_URL=", (app / "env.txt").read_text())
            self.assertEqual(main_module._profile_app_state["demo"]["state"], "stopped")

    def test_web_app_alias_and_port_reach_start_script_summary_and_reject_conflicts(self) -> None:
        update = main_module.update_profile_app_web
        payload = main_module.ProfileAppWebPayload

        async def scenario() -> list[dict[str, object]]:
            main_module.schedule_profile_app({"id": "p1", "app": "demo"})
            await main_module._profile_app_tasks["p1"]
            listed = await main_module.profile_web_apps()
            await main_module.release_profile_app("p1")
            return listed

        original_path = db.path
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app_dir = self.make_app(root)
            self.make_app(root, "otra")
            db.path = root / "web.db"
            db.initialize()
            try:
                with (
                    patch.object(settings, "profile_apps_root", str(root / "apps")),
                    patch.object(settings, "profile_apps", ""),
                    patch.object(main_module, "ROOT", root),
                    patch.object(main_module.db, "log"),
                    patch("backend.main.local_port_open", new=AsyncMock(return_value=True)),
                ):
                    result = asyncio.run(update("demo", payload(alias="RAG Kit", port=18500)))
                    self.assertEqual(result["web"], {"alias": "RAG Kit", "port": 18500, "url": "http://127.0.0.1:18500"})
                    for body in (
                        payload(alias="Otra", port=18500),
                        payload(alias="rag kit", port=18501),
                        payload(alias="Otra", port=settings.gateway_port),
                        payload(alias="Otra", port=30_010),
                        payload(alias="Otra", port=28088),
                    ):
                        with self.assertRaises(HTTPException) as raised:
                            asyncio.run(update("otra", body))
                        self.assertEqual(raised.exception.status_code, 409)
                    with self.assertRaises(HTTPException) as raised:
                        asyncio.run(update("inexistente", payload(alias="X", port=18600)))
                    self.assertEqual(raised.exception.status_code, 404)

                    profile = main_module.ProfilePayload.model_validate({
                        "name": "Choca", "engine": "ollama", "model_ref": "qwen3:8b", "port": 18500,
                        "context_size": 8192, "gpu_layers": 0, "threads": 1, "batch_size": 512,
                        "temperature": 0.7, "top_p": 0.9, "repeat_penalty": 1.1,
                    })
                    with self.assertRaises(HTTPException) as raised:
                        main_module.validate_profile(profile)
                    self.assertIn("demo", raised.exception.detail)

                    listed = asyncio.run(scenario())
                    self.assertEqual(
                        [(item["name"], item["alias"], item["port"], item["state"]) for item in listed],
                        [("demo", "RAG Kit", 18500, "running")],
                    )
                    env = (app_dir / "env.txt").read_text()
                    for line in ("MYDGX_APP_PORT=18500", "MYDGX_APP_HOST=127.0.0.1", "MYDGX_APP_ALIAS=RAG Kit", "MYDGX_APP_NAME=demo"):
                        self.assertIn(line, env)
                    self.assertEqual(asyncio.run(main_module.profile_web_apps()), [])

                    self.assertIsNone(asyncio.run(update("demo", payload(port=None)))["web"])
                    self.assertEqual(main_module.profile_apps_overview()["web"], {})
            finally:
                db.path = original_path

    def test_running_profile_models_get_short_labels(self) -> None:
        self.assertEqual(
            main_module.short_model_label({"model_ref": "AlicanKiraz0/Qwen3-14B-BaronLLM-v2-Q4_0-GGUF"}),
            "Qwen3-14B-BaronLLM-v2-Q4_0",
        )
        self.assertEqual(main_module.short_model_label({"model_ref": "qwen3:8b"}), "qwen3:8b")

    def test_split_gguf_keeps_the_snapshot_name_llama_cpp_needs(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(settings, "hf_home", directory):
            repo_dir = Path(directory) / "hub" / "models--Org--Big-GGUF"
            snapshot = repo_dir / "snapshots" / "0e17b7ba" / "Q4_K_M"
            blobs = repo_dir / "blobs"
            snapshot.mkdir(parents=True)
            blobs.mkdir()
            names = [f"Big-Q4_K_M-0000{index}-of-00002.gguf" for index in (1, 2)]
            for index, name in enumerate(names):
                blob = blobs / f"{index:064x}"
                blob.write_bytes(b"GGUF")
                (snapshot / name).symlink_to(blob)
            model = {"engine": "llama.cpp", "model_repo": "Org/Big-GGUF", "model_filename": f"Q4_K_M/{names[0]}", "task": "chat"}
            self.assertEqual(main_module.resolve_profile_model_file(model).name, names[0])
            configured = {"engine": "llama.cpp", "model_file": str(snapshot / names[0]), "task": "chat"}
            self.assertEqual(main_module.resolve_profile_model_file(configured).name, names[0])

    def test_cached_gguf_without_refs_main_is_found_offline(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(settings, "hf_home", directory):
            snapshot = Path(directory) / "hub" / "models--Org--Baron-GGUF" / "snapshots" / "0e17b7ba"
            snapshot.mkdir(parents=True)
            (snapshot / "baron-q6_k.gguf").write_bytes(b"GGUF")
            (Path(directory) / "secret.gguf").write_bytes(b"GGUF")
            model = {"engine": "llama.cpp", "model_repo": "Org/Baron-GGUF", "model_filename": "baron-q6_k.gguf", "task": "chat"}
            self.assertEqual(main_module.resolve_profile_model_file(model).resolve(), (snapshot / "baron-q6_k.gguf").resolve())
            self.assertTrue(main_module.profile_model_is_downloaded(model))
            for repo, filename in (("Org/Baron-GGUF", "../../../../secret.gguf"), ("../Org", "baron-q6_k.gguf")):
                with self.assertRaises(FileNotFoundError):
                    main_module.cached_hf_file(repo, filename)

    def test_profile_rejects_unknown_app(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(settings, "profile_apps_root", directory):
            payload = main_module.ProfilePayload.model_validate({
                "name": "Con app", "engine": "ollama", "model_ref": "qwen3:8b", "port": 18100,
                "context_size": 8192, "gpu_layers": 0, "threads": 1, "batch_size": 512,
                "temperature": 0.7, "top_p": 0.9, "repeat_penalty": 1.1, "app": "ragkit",
            })
            with self.assertRaises(HTTPException) as raised:
                main_module.validate_profile(payload)
            self.assertEqual(raised.exception.status_code, 400)


class DocumentationTests(unittest.TestCase):
    def test_every_route_is_documented(self) -> None:
        from fastapi.routing import APIRoute

        import backend.gateway as gateway_module

        for language in ("en", "es"):
            reference = (Path(__file__).resolve().parent.parent / "docs" / language / "api.md").read_text(encoding="utf-8")
            missing = []
            for application in (app, gateway_module.app):
                for route in application.routes:
                    if not isinstance(route, APIRoute) or route.path == "/{path:path}":
                        continue
                    path = route.path.replace(":path}", "}")
                    for method in sorted(route.methods - {"HEAD"}):
                        if f"| {method} | `{path}` |" not in reference:
                            missing.append(f"{method} {path}")
            self.assertEqual(missing, [], language)

    def test_every_setting_is_documented(self) -> None:
        for language in ("en", "es"):
            reference = (Path(__file__).resolve().parent.parent / "docs" / language / "configuracion.md").read_text(encoding="utf-8")
            missing = [name.upper() for name in type(settings).model_fields if f"| `{name.upper()}` |" not in reference]
            self.assertEqual(missing, [], language)

    def test_documentation_exists_in_both_languages(self) -> None:
        root = Path(__file__).resolve().parent.parent
        self.assertTrue((root / "README.md").is_file())
        self.assertTrue((root / "README.es.md").is_file())
        self.assertEqual(
            sorted(path.name for path in (root / "docs" / "en").glob("*.md")),
            sorted(path.name for path in (root / "docs" / "es").glob("*.md")),
        )


class TranslationTests(unittest.TestCase):
    def test_request_language_prefers_explicit_header_then_accept_language(self) -> None:
        self.assertEqual(request_language({"x-mydgx-language": "en", "accept-language": "es-ES"}), "en")
        self.assertEqual(request_language({"accept-language": "fr-FR,en-US;q=0.8"}), "en")
        self.assertEqual(request_language({"accept-language": "fr-FR"}), "es")

    def test_catalog_translates_templates_and_nested_values(self) -> None:
        catalog = Catalog({
            "Perfil no encontrado": "Profile not found",
            "No se pudo arrancar {0}: {1}": "Could not start {0}: {1}",
            "Literal {{json}} con {0}": "Literal {{json}} with {0}",
            "Modelo {0}": "Model {0}",
        })
        self.assertEqual(catalog.translate("Modelo qwen3:8b"), "Model qwen3:8b")
        self.assertEqual(
            catalog.translate("Modelo de embeddings configurado por la aplicación"),
            "Modelo de embeddings configurado por la aplicación",
        )
        self.assertEqual(catalog.translate("Perfil no encontrado"), "Profile not found")
        self.assertEqual(
            catalog.translate("No se pudo arrancar qwen: Perfil no encontrado"),
            "Could not start qwen: Profile not found",
        )
        self.assertEqual(catalog.translate("Literal {json} con 3"), "Literal {json} with 3")
        self.assertEqual(catalog.translate("Texto desconocido"), "Texto desconocido")
        self.assertEqual(
            catalog.translate("Perfil no encontrado: HTTPStatusError: 404"),
            "Profile not found: HTTPStatusError: 404",
        )

    def test_payload_keeps_identifier_and_enum_fields(self) -> None:
        catalog = Catalog({"No recomendado": "Not recommended"})
        with patch("backend.i18n.catalog", return_value=catalog):
            payload = translate_payload(
                {"recommendation_status": "No recomendado", "warnings": ["No recomendado"]}, "en"
            )
        self.assertEqual(payload, {"recommendation_status": "No recomendado", "warnings": ["Not recommended"]})
        catalog = Catalog({"Sistema": "System"})
        with patch("backend.i18n.catalog", return_value=catalog):
            profiles = translate_payload({"profiles": [{"name": "Sistema", "note": "Sistema"}]}, "en", "/api/profiles")
            storage = translate_payload({"home_directories": [{"name": "Sistema"}]}, "en", "/api/storage")
        self.assertEqual(profiles, {"profiles": [{"name": "Sistema", "note": "System"}]})
        self.assertEqual(storage, {"home_directories": [{"name": "System"}]})
        catalog = Catalog({"ACTIVAR FIRMWARE": "ENABLE FIRMWARE"})
        with patch("backend.i18n.catalog", return_value=catalog):
            setting = translate_payload({"settings": [{"key": "ENABLE_FIRMWARE_UPDATES", "confirm": "ACTIVAR FIRMWARE"}]}, "en")
        self.assertEqual(setting["settings"][0]["confirm"], "ACTIVAR FIRMWARE")

    def test_api_responses_follow_the_requested_language(self) -> None:
        catalog = Catalog({main_module.settings.app_name: "Translated", "ok": "fine"})
        with patch("backend.i18n.catalog", side_effect=lambda language: catalog if language == "en" else None), \
                TestClient(app) as client:
            english = client.get("/api/health", headers={"X-MyDGX-Language": "en"})
            spanish = client.get("/api/health", headers={"X-MyDGX-Language": "es"})
        self.assertEqual(english.json()["name"], "Translated")
        self.assertEqual(english.json()["status"], "ok")
        self.assertEqual(int(english.headers["content-length"]), len(english.content))
        self.assertEqual(spanish.json()["name"], main_module.settings.app_name)


if __name__ == "__main__":
    unittest.main()
