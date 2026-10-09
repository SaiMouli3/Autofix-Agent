"""Role-based access control.

Roles are per organization membership. Permissions are checked server-side on
every endpoint via ``require(perm)``.
"""

from __future__ import annotations

ROLES = ("org_admin", "agent_admin", "operator", "approver", "viewer")

ROLE_LABELS = {
    "org_admin": "Organization Administrator",
    "agent_admin": "Agent Administrator",
    "operator": "Agent Operator",
    "approver": "Approver",
    "viewer": "Read-only Viewer",
}

_VIEW = {
    "agents:read", "tasks:read", "integrations:read", "knowledge:read", "schedules:read",
    "approvals:read", "usage:read", "artifacts:read", "providers:read", "teams:read",
}

PERMISSIONS: dict[str, set[str]] = {
    "viewer": set(_VIEW),
    "approver": _VIEW | {"approvals:decide"},
    "operator": _VIEW | {"tasks:create", "tasks:cancel", "schedules:write"},
    "agent_admin": _VIEW
    | {
        "tasks:create", "tasks:cancel", "schedules:write", "approvals:decide",
        "agents:write", "integrations:write", "knowledge:write", "providers:test", "audit:read",
    },
    "org_admin": set(),  # filled below: everything
}

ALL_PERMISSIONS = set().union(*PERMISSIONS.values()) | {
    "providers:write", "users:write", "teams:write", "settings:write", "audit:read",
}
PERMISSIONS["org_admin"] = set(ALL_PERMISSIONS)


def has_permission(role: str, perm: str) -> bool:
    return perm in PERMISSIONS.get(role, set())
