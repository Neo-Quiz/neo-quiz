# Neo Quiz bug relay

A small Cloudflare Worker that receives bug reports from the app and files them
as issues on `Neo-Quiz/neo-quiz`, so the app never holds a GitHub secret.

Routes: `POST /report`, `GET /health`. Anything else is 404/405.

These are the owner's one-time steps. Until they are done, and the two
constants in `src/bug-report-config.ts` are filled, the app keeps opening the
prefilled GitHub issue page.

## 1. GitHub App

Create the App "Neo Quiz Reports" in the `Neo-Quiz` organisation (the GitHub
"manifest" flow is fine). Settings:

- No webhook.
- Permissions: Issues read and write, Metadata read.
- Device Flow: ON.
- Optional features: "Expire user authorization tokens" must be OFF. The app
  stores one user token and has no refresh logic.
- Install it on `Neo-Quiz/neo-quiz` only.

Note the App ID, the Client ID, and the Installation ID (the number at the end
of the installation URL). Generate a private key.

The labels `from-app` and `needs-triage` must exist on the repo (a missing
label never fails a report, but the issue then arrives unlabelled).

### Private key format

The Worker needs the key in PKCS#8 (`-----BEGIN PRIVATE KEY-----`). The
manifest flow gives PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`). The Worker also
accepts PKCS#1 directly, but converting is cleaner:

```
openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem
```

Without openssl (Windows), with Node:

```
node -e "const c=require('crypto'),f=require('fs');f.writeFileSync('key-pkcs8.pem',c.createPrivateKey(f.readFileSync('key.pem')).export({type:'pkcs8',format:'pem'}))"
```

Delete both key files once the secret is uploaded.

## 2. Cloudflare

```
npx wrangler login
npx wrangler kv namespace create STATE
```

Paste the printed id in `wrangler.toml` (`id = "..."`). Then, from this folder:

```
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY   # paste the whole PEM
npx wrangler deploy
```

Smoke test: `curl https://<worker-host>/health` answers `{"ok":true}`.

## 3. The app

Paste the Worker URL and the App's Client ID into BOTH copies of the constants:
`src/bug-report-config.ts` (`BUG_RELAY_URL`, `GITHUB_APP_CLIENT_ID`) and the Kotlin
`BugReportConfig` in `apps/android/app/src/main/java/com/ahmedmili/neoquiz/bridge/BugReportRules.kt`
(`RELAY_URL`, `GITHUB_CLIENT_ID`). `npm run check:android-pont` fails when the two differ.
No client secret is needed anywhere.

## Kill switch

```
npx wrangler secret put RELAY_ENABLED    # type: false
```

The Worker then answers `{"ok":false,"code":"disabled"}` and calls nothing.
Delete the secret (or set it to `true`) to resume.

## Limits

3 reports per 10 minutes and 10 per day per IP, 30 issues per day overall, an
identical body refused for 24 hours, 16384 bytes per request. KV is eventually
consistent, so these caps are approximate.

## Spike to run once deployed

Report as an identified user who is NOT a collaborator on the repo: the issue
should be created with the user's own token, or, when GitHub refuses (403),
through the App with "Reported by @login" at the top. Confirm both paths on a
real account (see the spec's "Open item").
