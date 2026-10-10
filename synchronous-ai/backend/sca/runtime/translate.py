"""Translate OpenHands SDK events into safe, user-facing activity events.

Hidden model reasoning (``reasoning_content``, thinking blocks, encrypted reasoning
items) and free-form "thought" text are deliberately dropped. Activity shows the
LLM-provided one-line action summary, tool name, key arguments, tool results
(truncated) and final messages.
"""

from __future__ import annotations

from typing import Any

MAX_TEXT = 4000

# Action fields that are safe and useful to display, per tool.
_ARG_KEYS = ("command", "path", "pattern", "include", "url", "query", "old_str", "new_str", "file_text",
             "view_range", "insert_line", "task_list", "timeout", "is_input", "integration", "operation",
             "agent_name", "objective")


def _clip(s: str, n: int = MAX_TEXT) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + f"\n... [{len(s) - n} more characters]"


def _text_of(contents) -> str:
    out = []
    for c in contents or []:
        t = getattr(c, "text", None)
        if t:
            out.append(t)
    return "\n".join(out)


def _action_args(action) -> dict[str, Any]:
    if action is None:
        return {}
    try:
        data = action.model_dump(exclude_none=True, mode="json")
    except Exception:  # noqa: BLE001
        return {}
    args: dict[str, Any] = {}
    for k in _ARG_KEYS:
        if k in data:
            v = data[k]
            args[k] = _clip(v, 1500) if isinstance(v, str) else v
    if not args:  # MCP tools and unknown actions: show their (bounded) arguments
        for k, v in list(data.items())[:8]:
            if k in ("kind", "security_risk", "summary"):
                continue
            args[k] = _clip(v, 600) if isinstance(v, str) else v
    return args


def translate(event) -> tuple[str, str, dict[str, Any]] | None:
    name = type(event).__name__
    if name == "ActionEvent":
        tool = event.tool_name
        args = _action_args(event.action)
        summary = event.summary or ""
        if not summary:
            if "command" in args and tool == "terminal":
                summary = f"$ {str(args['command'])[:160]}"
            elif "path" in args:
                summary = f"{args.get('command', tool)} {args['path']}"
            else:
                summary = f"calling {tool}"
        risk = getattr(event.security_risk, "value", str(event.security_risk))
        return "tool_call", summary, {"tool": tool, "args": args, "risk": risk, "tool_call_id": event.tool_call_id}
    if name == "ObservationEvent":
        obs = event.observation
        text = ""
        try:
            text = obs.text
        except Exception:  # noqa: BLE001
            text = _text_of(getattr(obs, "content", []))
        is_error = bool(getattr(obs, "is_error", False))
        first = (text.strip().splitlines() or [""])[0][:200]
        return ("tool_result", f"{event.tool_name}: {first}" if first else f"{event.tool_name} finished",
                {"tool": event.tool_name, "output": _clip(text), "is_error": is_error,
                 "tool_call_id": event.tool_call_id})
    if name == "UserRejectObservation":
        return ("tool_rejected", f"{event.tool_name} rejected: {event.rejection_reason[:200]}",
                {"tool": event.tool_name, "reason": event.rejection_reason})
    if name == "AgentErrorEvent":
        return "tool_error", f"{event.tool_name}: {event.error[:200]}", {"tool": event.tool_name, "error": _clip(event.error)}
    if name == "MessageEvent":
        if event.source == "user":
            return None  # task instructions are already recorded
        text = _text_of(event.llm_message.content)
        if not text.strip():
            return None
        return "message", _clip(text, 300), {"text": _clip(text, 20_000)}
    if name == "ConversationErrorEvent":
        return "error", f"{event.code}: {event.detail[:300]}", {"code": event.code, "detail": _clip(event.detail)}
    if name in ("PauseEvent", "InterruptEvent"):
        return "paused", "execution paused", {}
    if name == "Condensation":
        return "progress", "context condensed to stay within the model window", {}
    return None  # SystemPrompt, state updates, token streaming, etc.
