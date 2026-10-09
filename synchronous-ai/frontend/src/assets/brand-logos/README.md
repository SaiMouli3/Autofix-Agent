# Licensed connector logos

Put a vendor's official logo here to use it for that connector. Name the file after the
connector key, for example `slack.svg`, `microsoft_365.svg` or `salesforce.svg` (a `.png` also
works). Files here are bundled at build time and replace the built-in icon or monogram. MCP
variants reuse the main file; for example, `salesforce.svg` also covers `salesforce_mcp`.

Only add a logo when your organization may use it:

- **Slack:** the logo is allowed for apps listed in the Slack App Directory, or under a written
  license (brand.slackhq.com/terms-of-service). The files come from Slack's brand center.
- **Microsoft 365:** this needs a Microsoft trademark license (Microsoft 365 trademark
  guidelines). The files come through that license.
- **Salesforce:** this needs written permission, for example through the AppExchange or Partner
  Program (salesforce.com/company/legal/tmcusageguidelines). The files come from Brand Central.

Don't recolor, crop or modify the files. Keep a record of the permission next to your
deployment, not in this repository.

## Files in this folder

The repository owner confirmed on 2026-10-09 that the organization has permission to use these
marks. Each file was downloaded unmodified from the vendor's own servers:

| File | Source |
|---|---|
| `salesforce.svg` | `https://c1.sfdcstatic.com/content/dam/sfdc-docs/www/logos/logo-salesforce.svg` (Salesforce CDN) |
| `slack.png` | `https://a.slack-edge.com/80588/marketing/img/meta/slack_hash_256.png` (Slack CDN) |
| `microsoft_365.svg` | `https://res.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/m365_48x1.svg` (Microsoft Fluent UI brand icons) |

If you redistribute this code, make sure the recipient has their own permission, or remove these files.
