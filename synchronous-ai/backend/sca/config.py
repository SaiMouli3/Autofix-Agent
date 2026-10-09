"""Application configuration.

All settings come from environment variables (prefix ``SCA_``) or a ``.env`` file.
Provider credentials are *not* settings: they are stored encrypted in the database
(see ``sca.services.secrets``). The ``EXP_LABS_*`` variables are only read once, at
bootstrap, to seed the Experiential Labs provider for a fresh organization.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SCA_", env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    data_dir: Path = Path("./data")
    database_url: str = ""  # defaults to sqlite in data_dir

    # 32-byte urlsafe base64 Fernet key(s), comma separated; first one encrypts.
    # Required in production. In development a key is generated into data_dir.
    secret_key: str = ""

    # Public base URL of the API as reachable *by agents* (platform MCP server).
    internal_base_url: str = "http://127.0.0.1:8000"
    public_base_url: str = "http://localhost:8000"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Sessions
    session_ttl_hours: int = 12
    cookie_secure: bool = False  # forced True in production

    # Bootstrap: when set, /api/auth/setup requires this token.
    bootstrap_token: str = ""

    # Execution
    runtime: Literal["local", "docker"] = "local"
    llm_num_retries: int = 3  # provider-level retries inside one LLM call (LiteLLM)
    max_workers: int = 4  # global bound on concurrently running tasks (per process)
    dispatch_interval_s: float = 0.5
    lease_seconds: int = 60
    default_task_timeout_s: int = 1800
    approval_timeout_s: int = 3600
    docker_image: str = "ghcr.io/openhands/agent-server:1.53.0-python"
    docker_network: str = ""  # optional user-defined network for sandboxes
    # Egress for sandboxes behind a corporate proxy: proxy URL as seen from containers and an
    # optional CA bundle (PEM) mounted read-only into each sandbox.
    docker_proxy_url: str = ""
    docker_ca_bundle: str = ""
    enable_browser_tool: bool = False  # requires Chromium in the runtime
    allow_stdio_mcp: bool = False  # stdio MCP servers run commands on the host

    # Outbound network guard for HTTP integrations / MCP servers
    allow_private_network_targets: bool = False
    allowed_private_hosts: Annotated[list[str], NoDecode] = Field(default_factory=list)
    integration_max_response_bytes: int = 1_000_000
    integration_timeout_s: float = 30.0

    # Knowledge
    max_upload_bytes: int = 25 * 1024 * 1024
    embedding_model: str = "text-embedding-3-small"

    # Rate limiting (requests per minute per client)
    rate_limit_auth_per_min: int = 10
    rate_limit_api_per_min: int = 600

    # Retention
    event_retention_days: int = 90
    audit_retention_days: int = 365

    # Seed provider (bootstrap only)
    exp_labs_base_url: str = Field(default="", validation_alias="EXP_LABS_BASE_URL")
    exp_labs_api_key: str = Field(default="", validation_alias="EXP_LABS_API_KEY")
    exp_labs_model: str = Field(default="", validation_alias="EXP_LABS_MODEL")

    start_workers: bool = True  # tests may disable background threads

    @field_validator("cors_origins", "allowed_private_hosts", mode="before")
    @classmethod
    def _split(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'sca.db').resolve()}"

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def workspaces_dir(self) -> Path:
        return (self.data_dir / "workspaces").resolve()

    @property
    def uploads_dir(self) -> Path:
        return (self.data_dir / "uploads").resolve()


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir = s.data_dir.resolve()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    if s.is_production:
        s.cookie_secure = True
        if not s.secret_key:
            raise RuntimeError("SCA_SECRET_KEY is required in production")
    return s
