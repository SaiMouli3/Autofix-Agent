"""Prebuilt connectors for common business systems.

A connector is a parameterised integration definition. Instantiating one produces an ordinary
integration in the ``proposed`` state: an administrator still attaches the credential, runs a live
connection test, reviews the operations and activates it. Connectors never ship credentials and
never mark anything as connected.

Endpoints and versions were checked against the vendors' public APIs on 2026-10-09:
Shopify Admin API 2026-07 (latest stable), Meta Graph / Marketing API v26.0 (released 2026-07-29),
WhatsApp Cloud API on the Graph API, and Meta's hosted Ads MCP server (OAuth-protected resource
at https://mcp.facebook.com/ads).
"""

from __future__ import annotations

import copy
import re
from typing import Any

from sca.config import get_settings

_STR = {"type": "string"}
_OBJ = {"type": "object"}


def _props(required: list[str] | None = None, **props: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


_GRAPH_PAGING = {
    "limit": {"type": "integer", "description": "Page size (Graph API default 25)."},
    "after": {"type": "string", "description": "Cursor from paging.cursors.after of the previous page."},
}
_INSIGHT_ARGS = {
    "date_preset": {"type": "string", "description": "e.g. today, yesterday, last_7d, last_30d, this_month, last_month, maximum"},
    "time_range": {"type": "string", "description": 'JSON string, e.g. {"since":"2026-09-01","until":"2026-09-30"}; overrides date_preset'},
    "level": {"type": "string", "enum": ["account", "campaign", "adset", "ad"]},
    "breakdowns": {"type": "string", "description": "Comma-separated, e.g. age,gender or publisher_platform"},
    "time_increment": {"type": "string", "description": "1 for daily rows, monthly, or all_days"},
    "fields": {"type": "string", "description": "Override the default metric list"},
    **_GRAPH_PAGING,
}
_INSIGHT_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,cost_per_action_type,purchase_roas"
_GRAPH_VERSION = {"key": "api_version", "label": "Graph API version", "default": "v26.0", "pattern": r"^v\d{2}\.\d$",
                  "help": "Meta releases a new version roughly twice a year; each is supported for about two years."}

CONNECTORS: list[dict[str, Any]] = [
    {
        "key": "shopify_admin",
        "name": "Shopify Admin",
        "vendor": "Shopify",
        "type": "http",
        "category": "business_api",
        "summary": "Products, orders, customers, inventory and fulfilment through the Shopify Admin GraphQL API.",
        "docs_url": "https://shopify.dev/docs/api/admin-graphql",
        "params": [
            {"key": "shop", "label": "Store handle", "pattern": r"^[a-z0-9][a-z0-9-]{0,60}$",
             "help": "The part before .myshopify.com, e.g. acme-store for acme-store.myshopify.com.",
             "normalize": "shopify_shop"},
            {"key": "api_version", "label": "API version", "default": "2026-07", "pattern": r"^\d{4}-(01|04|07|10)$",
             "help": "Shopify's latest stable version on 2026-10-09 was 2026-07."},
        ],
        "credential": {
            "label": "Admin API access token",
            "help": "Create a custom app in Shopify admin (Settings → Apps and sales channels → Develop apps), grant "
                    "only the Admin API scopes the agents need (for example read_products, read_orders, read_customers, "
                    "read_inventory) and paste its Admin API access token (starts with shpat_).",
        },
        "config": {
            "base_url": "https://{{shop}}.myshopify.com/admin/api/{{api_version}}",
            "auth": {"type": "api_key_header", "header_name": "X-Shopify-Access-Token"},
            "health_check_path": "/shop.json",
            "rate_limit_per_min": 120,
            "timeout_s": 30,
            "operations": [
                {
                    "name": "graphql_query",
                    "description": "Run a read-only Admin GraphQL query (mutations are rejected by the gateway). Examples: "
                                   "{ orders(first: 20, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt "
                                   "displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } } } } — "
                                   "{ products(first: 20, query: \"status:active\") { nodes { title totalInventory } } }. "
                                   "Paginate with pageInfo { hasNextPage endCursor } and after:.",
                    "method": "POST", "path": "/graphql.json", "graphql": "query",
                    "params_schema": _props(["query"], query={"type": "string", "description": "GraphQL query document"},
                                            variables={"type": "object", "description": "GraphQL variables"}),
                },
                {
                    "name": "graphql_mutation",
                    "description": "Run an Admin GraphQL mutation (creates, updates or deletes store data). Every call "
                                   "waits for human approval. Check userErrors in the response.",
                    "method": "POST", "path": "/graphql.json", "graphql": "mutation",
                    "requires_approval": True, "enabled": False,
                    "params_schema": _props(["query"], query={"type": "string", "description": "GraphQL mutation document"},
                                            variables={"type": "object"}),
                },
            ],
        },
    },
    {
        "key": "meta_marketing",
        "name": "Meta Ads",
        "vendor": "Meta",
        "type": "http",
        "category": "business_api",
        "summary": "Campaign, ad set and ad reporting for one ad account through the Meta Marketing API, plus "
                   "approval-gated pause/resume and budget changes.",
        "docs_url": "https://developers.facebook.com/docs/marketing-api",
        "params": [
            {"key": "ad_account_id", "label": "Ad account ID", "pattern": r"^\d{5,20}$",
             "help": "Numeric ID from Ads Manager; the act_ prefix is optional.", "normalize": "strip_act"},
            _GRAPH_VERSION,
        ],
        "credential": {
            "label": "Access token",
            "help": "A System User access token from Meta Business Settings with ads_read (reporting) and, only if you "
                    "enable the change operations, ads_management. System User tokens do not expire like user tokens.",
        },
        "config": {
            "base_url": "https://graph.facebook.com/{{api_version}}",
            "auth": {"type": "bearer"},
            "health_check_path": "/act_{{ad_account_id}}?fields=name,account_status,currency",
            "rate_limit_per_min": 60,
            "timeout_s": 60,
            "operations": [
                {"name": "get_ad_account", "description": "Ad account name, status, currency, time zone and lifetime spend.",
                 "method": "GET", "path": "/act_{{ad_account_id}}",
                 "default_query": {"fields": "name,account_status,currency,timezone_name,amount_spent,spend_cap"},
                 "params_schema": _props(fields=_STR)},
                {"name": "list_campaigns", "description": "Campaigns with status, objective and budgets (budgets are in "
                                                          "the account currency's minor unit, e.g. cents).",
                 "method": "GET", "path": "/act_{{ad_account_id}}/campaigns",
                 "default_query": {"fields": "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time"},
                 "params_schema": _props(fields=_STR, effective_status={"type": "string", "description": 'JSON array, e.g. ["ACTIVE","PAUSED"]'}, **_GRAPH_PAGING)},
                {"name": "list_adsets", "description": "Ad sets with status, budgets, optimisation goal and campaign.",
                 "method": "GET", "path": "/act_{{ad_account_id}}/adsets",
                 "default_query": {"fields": "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,bid_strategy"},
                 "params_schema": _props(fields=_STR, effective_status=_STR, **_GRAPH_PAGING)},
                {"name": "list_ads", "description": "Ads with status and parent ad set / campaign.",
                 "method": "GET", "path": "/act_{{ad_account_id}}/ads",
                 "default_query": {"fields": "id,name,status,effective_status,adset_id,campaign_id,created_time"},
                 "params_schema": _props(fields=_STR, effective_status=_STR, **_GRAPH_PAGING)},
                {"name": "get_account_insights", "description": "Performance metrics for the ad account; use level to "
                                                                "break down by campaign, adset or ad.",
                 "method": "GET", "path": "/act_{{ad_account_id}}/insights",
                 "default_query": {"fields": _INSIGHT_FIELDS, "date_preset": "last_7d"},
                 "params_schema": _props(**_INSIGHT_ARGS)},
                {"name": "get_object_insights", "description": "Performance metrics for one campaign, ad set or ad.",
                 "method": "GET", "path": "/{object_id}/insights",
                 "default_query": {"fields": _INSIGHT_FIELDS, "date_preset": "last_7d"},
                 "params_schema": _props(["object_id"], object_id={"type": "string", "description": "Campaign, ad set or ad ID"}, **_INSIGHT_ARGS)},
                {"name": "set_status", "description": "Pause or activate a campaign, ad set or ad. Waits for human approval.",
                 "method": "POST", "path": "/{object_id}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["object_id", "status"], object_id=_STR,
                                         status={"type": "string", "enum": ["ACTIVE", "PAUSED"]})},
                {"name": "set_daily_budget", "description": "Change the daily budget of a campaign or ad set, in the "
                                                            "currency's minor unit (e.g. 5000 = 50.00). Waits for human approval.",
                 "method": "POST", "path": "/{object_id}", "requires_approval": True, "enabled": False,
                 "params_schema": _props(["object_id", "daily_budget"], object_id=_STR,
                                         daily_budget={"type": "integer", "minimum": 1})},
            ],
        },
    },
    {
        "key": "whatsapp_cloud",
        "name": "WhatsApp Business",
        "vendor": "Meta",
        "type": "http",
        "category": "communication",
        "summary": "Send WhatsApp messages and list approved templates through the WhatsApp Cloud API. Every send "
                   "waits for human approval.",
        "docs_url": "https://developers.facebook.com/docs/whatsapp/cloud-api",
        "params": [
            {"key": "phone_number_id", "label": "Phone number ID", "pattern": r"^\d{5,25}$",
             "help": "From WhatsApp Manager → API setup (not the phone number itself)."},
            {"key": "waba_id", "label": "WhatsApp Business Account ID", "pattern": r"^\d{5,25}$",
             "help": "Needed to list message templates."},
            _GRAPH_VERSION,
        ],
        "credential": {
            "label": "Access token",
            "help": "A System User access token with whatsapp_business_messaging and whatsapp_business_management, "
                    "assigned to this WhatsApp Business Account.",
        },
        "config": {
            "base_url": "https://graph.facebook.com/{{api_version}}",
            "auth": {"type": "bearer"},
            "health_check_path": "/{{phone_number_id}}?fields=display_phone_number,verified_name,quality_rating",
            "rate_limit_per_min": 60,
            "timeout_s": 30,
            "operations": [
                {"name": "get_phone_number", "description": "Display number, verified name, quality rating and messaging limit.",
                 "method": "GET", "path": "/{{phone_number_id}}",
                 "default_query": {"fields": "display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status"},
                 "params_schema": _props(fields=_STR)},
                {"name": "list_message_templates", "description": "Message templates with approval status, language and components.",
                 "method": "GET", "path": "/{{waba_id}}/message_templates",
                 "default_query": {"fields": "name,status,language,category,components"},
                 "params_schema": _props(status={"type": "string", "description": "APPROVED, PENDING or REJECTED"}, **_GRAPH_PAGING)},
                {"name": "send_text_message",
                 "description": "Send a free-form text. WhatsApp only delivers these within 24 hours of the customer's last "
                                "message; otherwise use send_template_message. Waits for human approval.",
                 "method": "POST", "path": "/{{phone_number_id}}/messages", "requires_approval": True,
                 "fixed_body": {"messaging_product": "whatsapp", "recipient_type": "individual", "type": "text"},
                 "params_schema": _props(["to", "text"],
                                         to={"type": "string", "pattern": r"^\+?[0-9]{6,15}$", "description": "E.164 number, e.g. 447700900123"},
                                         text=_props(["body"], body={"type": "string", "maxLength": 4096}, preview_url={"type": "boolean"}))},
                {"name": "send_template_message",
                 "description": "Send an approved template (works outside the 24-hour window). Waits for human approval.",
                 "method": "POST", "path": "/{{phone_number_id}}/messages", "requires_approval": True,
                 "fixed_body": {"messaging_product": "whatsapp", "recipient_type": "individual", "type": "template"},
                 "params_schema": _props(["to", "template"],
                                         to={"type": "string", "pattern": r"^\+?[0-9]{6,15}$"},
                                         template=_props(["name", "language"], name=_STR,
                                                         language=_props(["code"], code={"type": "string", "description": "e.g. en_US"}),
                                                         components={"type": "array", "description": "Header/body/button parameters"}))},
            ],
        },
    },
    {
        "key": "meta_ads_mcp",
        "name": "Meta Ads MCP",
        "vendor": "Meta",
        "type": "mcp",
        "category": "business_api",
        "summary": "Meta's hosted Ads MCP server: reporting, campaign management, catalogs and signal diagnostics as "
                   "MCP tools. Tool calls follow the agent's approval policy.",
        "docs_url": "https://developers.facebook.com/docs/marketing-api",
        "params": [],
        "credential": {
            "label": "OAuth access token",
            "help": "The server is an OAuth-protected resource (authorization server www.facebook.com/ads; scopes such "
                    "as ads_read, ads_management, ads_mcp_management). This platform does not run the interactive OAuth "
                    "sign-in, so paste an access token issued for those scopes. Use Test connection to confirm Meta "
                    "accepts it before activating.",
        },
        "notes": "Beta service from Meta; tool names and behaviour may change. Use Allowed tools to restrict what agents can call.",
        "config": {"transport": "http", "url": "https://mcp.facebook.com/ads", "auth_header": "Authorization",
                   "auth_scheme": "Bearer", "timeout_s": 120},
    },
    {
        "key": "shopify_dev_mcp",
        "name": "Shopify Dev MCP",
        "vendor": "Shopify",
        "type": "mcp",
        "category": "developer_tools",
        "summary": "Shopify documentation search and Admin GraphQL schema exploration for developer agents. No store "
                   "data and no credential. Runs locally with npx.",
        "docs_url": "https://shopify.dev/docs/apps/build/devmcp",
        "params": [],
        "credential": None,
        "notes": "stdio servers run on the platform host and are disabled unless SCA_ALLOW_STDIO_MCP=true; requires Node.js 18+.",
        "config": {"transport": "stdio", "command": "npx", "args": ["-y", "@shopify/dev-mcp@1.16.0"], "timeout_s": 120},
    },
]

_BY_KEY = {c["key"]: c for c in CONNECTORS}


class ConnectorError(ValueError):
    pass


def public_catalog() -> list[dict[str, Any]]:
    """Connector metadata for the UI (no config internals beyond what helps a reviewer)."""
    out = []
    for c in CONNECTORS:
        item = {k: c[k] for k in ("key", "name", "vendor", "type", "category", "summary", "docs_url", "params", "credential")}
        item["notes"] = c.get("notes", "")
        item["available"], item["unavailable_reason"] = True, ""
        if c["type"] == "mcp" and c["config"].get("transport") == "stdio" and not get_settings().allow_stdio_mcp:
            item["available"] = False
            item["unavailable_reason"] = "Local (stdio) MCP servers are disabled on this deployment (SCA_ALLOW_STDIO_MCP=false)."
        if c["type"] == "http":
            item["operations"] = [
                {"name": o["name"], "method": o["method"], "description": o["description"],
                 "requires_approval": bool(o.get("requires_approval")), "enabled": o.get("enabled", True),
                 "read_only": o.get("graphql") == "query" or o["method"] == "GET"}
                for o in c["config"]["operations"]]
        out.append(item)
    return out


def _normalize(kind: str | None, value: str) -> str:
    v = value.strip()
    if kind == "shopify_shop":
        v = re.sub(r"^https?://", "", v.lower()).split("/")[0]
        v = v.removesuffix(".myshopify.com")
    elif kind == "strip_act":
        v = v.removeprefix("act_")
    return v


def _fill(obj: Any, values: dict[str, str]) -> Any:
    if isinstance(obj, str):
        return re.sub(r"\{\{([a-z_]+)\}\}", lambda m: values[m.group(1)], obj)
    if isinstance(obj, list):
        return [_fill(x, values) for x in obj]
    if isinstance(obj, dict):
        return {k: _fill(v, values) for k, v in obj.items()}
    return obj


def instantiate(key: str, params: dict[str, Any]) -> dict[str, Any]:
    """Return ``{name, description, type, category, config}`` for an integration built from a connector."""
    c = _BY_KEY.get(key)
    if c is None:
        raise ConnectorError(f"unknown connector '{key}'")
    values: dict[str, str] = {}
    for p in c["params"]:
        raw = params.get(p["key"])
        raw = p.get("default", "") if raw in (None, "") else str(raw)
        v = _normalize(p.get("normalize"), raw)
        if not re.fullmatch(p["pattern"], v):
            raise ConnectorError(f"{p['label']}: '{v}' is not valid")
        values[p["key"]] = v
    unknown = set(params) - {p["key"] for p in c["params"]}
    if unknown:
        raise ConnectorError(f"unknown parameters: {sorted(unknown)}")
    config = _fill(copy.deepcopy(c["config"]), values)
    desc = c["summary"]
    if values:
        desc += " (" + ", ".join(f"{p['label']}: {values[p['key']]}" for p in c["params"]) + ")"
    return {"name": c["name"], "description": desc, "type": c["type"], "category": c["category"], "config": config}
