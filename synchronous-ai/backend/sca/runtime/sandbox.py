"""Workspace provisioning for agent sessions.

``local`` runtime: the OpenHands LocalConversation runs in the platform process and
tools act on a per-session directory under ``<data_dir>/workspaces``. This is meant
for development and trusted single-tenant use — it is NOT an isolation boundary.

``docker`` runtime: each execution gets an OpenHands agent-server container
(``openhands-workspace`` DockerWorkspace) with CPU, memory and PID limits and
``no-new-privileges``. The Docker socket and host credentials are never mounted;
the only host mount is the session's project directory.
"""

from __future__ import annotations

import os
import shutil
import threading
from pathlib import Path

from sca.config import get_settings

_start_lock = threading.Lock()  # serialises the docker-run flag injection below


def session_dir(org_id: str, agent_id: str, session_id: str) -> Path:
    root = get_settings().workspaces_dir
    p = (root / org_id / agent_id / session_id).resolve()
    if not str(p).startswith(str(root)):
        raise ValueError("invalid workspace path")
    (p / "project").mkdir(parents=True, exist_ok=True)
    (p / "state").mkdir(parents=True, exist_ok=True)
    return p


def docker_available() -> bool:
    return shutil.which("docker") is not None and os.path.exists("/var/run/docker.sock")


def make_docker_workspace(host_project_dir: Path, cpu: float, memory_mb: int):
    """Start a resource-limited OpenHands agent-server container for one execution."""
    from openhands.workspace import DockerWorkspace
    from openhands.workspace.docker import workspace as dw_module

    s = get_settings()
    os.chmod(host_project_dir, 0o777)  # container user differs from host user
    extra = [
        f"--cpus={cpu}",
        f"--memory={memory_mb}m",
        f"--memory-swap={memory_mb}m",
        "--pids-limit=512",
        "--security-opt=no-new-privileges",
        "--add-host=host.docker.internal:host-gateway",
        "--label=sca.sandbox=1",
    ]
    if s.docker_proxy_url:
        no_proxy = "localhost,127.0.0.1,host.docker.internal"
        for var in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
            extra += ["-e", f"{var}={s.docker_proxy_url}"]
        extra += ["-e", f"NO_PROXY={no_proxy}", "-e", f"no_proxy={no_proxy}"]
    if s.docker_ca_bundle:
        extra += ["-v", f"{s.docker_ca_bundle}:/etc/sca/ca-bundle.crt:ro"]
        for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
            extra += ["-e", f"{var}=/etc/sca/ca-bundle.crt"]
    original = dw_module.execute_command

    # The SDK requests nofile=65536; clamp to the host's hard limit, which Docker cannot exceed.
    import resource

    hard = resource.getrlimit(resource.RLIMIT_NOFILE)[1]
    nofile = 65536 if hard == resource.RLIM_INFINITY else min(65536, hard)

    def patched(cmd, *a, **kw):
        if isinstance(cmd, list) and cmd[:3] == ["docker", "run", "-d"]:
            cmd = [f"nofile={nofile}:{nofile}" if c == "nofile=65536:65536" else c for c in cmd]
            cmd = cmd[:3] + extra + cmd[3:]
        return original(cmd, *a, **kw)

    with _start_lock:
        dw_module.execute_command = patched
        try:
            return DockerWorkspace(
                server_image=s.docker_image,
                working_dir="/workspace/project",
                volumes=[f"{host_project_dir}:/workspace/project:rw"],
                network=s.docker_network or None,
                detach_logs=False,
                health_check_timeout=180,
            )
        finally:
            dw_module.execute_command = original
