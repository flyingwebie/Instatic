# Form redirects and integration research

Research date: 2026-10-05. Source checkout: `f4e692f7`. This is an assessment, not an implemented feature specification.

## Existing capabilities

| Requirement | Current support |
| --- | --- |
| Redirect after a successful CMS submission | Built in: select Success behavior → Redirect and enter Redirect URL. |
| Fixed redirect query parameters | Built in by including them in the URL, e.g. `/thank-you?source=contact`. |
| Redirect parameters derived from submitted fields | Not implemented. The runtime assigns the configured URL unchanged; it does not interpolate fields. |
| External native form POST | Built in: Custom action mode, Action URL, Method POST. |
| Save in Instatic and POST to another service | Possible through a server plugin; no built-in form webhook configuration found. |

Sources: [form props, settings and render](../../src/modules/base/forms/index.ts), [browser submission runtime](../../src/modules/base/forms/formRuntimeJs.ts), [feature documentation](../features/cms-native-forms.md).

CMS mode validates against the published form and its target data table, stores a row, emits `content.entry.created`, and returns `{ ok: true, rowId }`. The browser then redirects or displays success. It currently ignores the returned row ID. Custom mode is plain HTML submission: it does not run the CMS challenge, storage or success runtime. The receiving endpoint owns the response and any redirect. A native POST does not provide a JSON body or configurable authorization headers.

Sources: [submission handler](../../server/forms/handler.ts), [form renderer](../../src/modules/base/forms/index.ts), [runtime](../../src/modules/base/forms/formRuntimeJs.ts).

## Integration available through plugins

A plugin can listen for `content.entry.created`, filter by `tableSlug`, load the new entry by `entryId`, map its cells, and perform a server-side HTTP POST. Required grants include `cms.hooks`, `cms.content.read` with the appropriate table access, and `network.outbound` with `networkAllowedHosts`. Plugin secret settings can hold authorization credentials encrypted at rest rather than exposing them in published form props.

Sources: [plugin hooks, content API, secrets and outbound HTTP documentation](../features/plugin-system.md), [permission dispatch](../../server/plugins/protocol/targets.ts), [content event payload](../../server/publish/contentEvents.ts).

Limitations: the event identifies table, entry and actor, not form or page. `actor.kind === 'system'` is not a unique form marker. A dedicated submissions table makes an initial integration straightforward; distinguishing multiple forms sharing a table needs explicit provenance. Event listeners run sequentially and are awaited by the submission handler. Listener errors are logged and swallowed; this is not a durable delivery queue with automatic retries. A slow direct POST can delay the success response and redirect.

Sources: [hook bus](../../src/core/plugins/hookBus.ts), [submission handler](../../server/forms/handler.ts), [event actor documentation](../features/content-storage.md).

Outbound plugin requests validate allowed hosts and resolved addresses on every redirect hop. Private and loopback destinations are blocked, which matters for a CRM or n8n instance on a private self-hosted network. Current plugin integration requires a reachable permitted public hostname; private-network support would need a deliberate policy change.

Source: [network enforcement](../../server/plugins/host/network.ts).

## Recommended upgrade (proposal)

Retain CMS storage and validation. Extend its existing success redirect with optional explicit query mappings: parameter name → static value, selected validated field, or submission ID. Build URLs with `URL`/`URLSearchParams`, preserve existing query strings and fragments, and define behavior for missing values and arrays. Use selected fields rather than forwarding the entire submission. Personal data in a URL enters history, logs and analytics; prefer an opaque submission reference where feasible.

Add optional server-side webhook delivery after successful persistence. Keep endpoint authentication in server-managed integration settings, referenced by the form. A generic JSON POST can carry a stable event ID, submission ID, form/page identifiers and selected validated fields; CRM-specific payloads can be mapped by a plugin or automation service.

For reliable delivery, persist the submission and an outbound job atomically, then return success and redirect without waiting for the CRM. A worker sends the POST with bounded timeouts, retry backoff, stable delivery IDs, delivery status and manual retry. Duplicate delivery remains possible; receivers should deduplicate by event ID. Store the destination/payload policy with the job so later form edits do not silently change pending deliveries. Any new database tables/columns require new additive migrations in both database dialects.

These are architectural recommendations based on the synchronous, non-durable current hook flow, not claims about existing features.

## Practical choices

1. Existing settings alone: CMS form + redirect with fixed parameters.
2. Small integration plugin: existing content hook + mapped server POST, alongside the existing redirect. Useful now, but delivery reliability must be designed explicitly.
3. Product feature: optional dynamic redirect parameters + configurable durable webhook delivery. Best fit for reusable no-code form integrations.
4. External-only collection: Custom action POST when the destination accepts traditional HTML forms and owns the success page; submissions are not also saved by Instatic.

n8n is one compatible intermediary: its Webhook node supports POST, authentication, distinct production URLs and immediate responses. It can map a generic Instatic payload into service-specific workflows. Current Instatic plugin private-address restrictions still apply.

Source: [official n8n Webhook documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/).

## Validation scope

Read-only inspection of source and documentation, plus official n8n documentation. No application code changed, no live submissions sent, and no browser or runtime tests performed.
