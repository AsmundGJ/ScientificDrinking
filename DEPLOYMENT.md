# Deploying Pace to pace.asmunden.com

Pace is a fully static PWA — no backend, no database. Deployment means serving the
contents of `dist/pace/browser` over HTTPS. HTTPS is required or the service worker
(the offline-at-the-festival guarantee) will not register.

The repo ships with `.github/workflows/deploy.yml` (GitHub Pages, automatic) and
`public/_redirects` (in case you ever switch to Cloudflare Pages/Netlify).

## Important: which folder is the repo

The app's git repo is **this folder** (`pace/`), not the `ScientificDrinking` folder
above it. The outer folder has its own repo that only stores a *pointer* to this one —
pushing the outer repo would upload no app code. Push `pace` itself.

## Step by step (GitHub Pages)

**1. Commit and push the app**

```bash
cd pace
git add -A
git commit -m "Pace: festival build + deploy workflow"
git branch -M main            # optional: rename master → main
```

The repo must be **public** (GitHub Pages on private repos needs a paid plan).
An existing repo works exactly as well as a new one — make it public under
Settings → General → Danger Zone → "Change repository visibility". The repo
name is irrelevant to the custom domain.

If the remote isn't set up yet:

```bash
git remote add origin git@github.com:<your-username>/<repo>.git
git push -u origin main
```

**2. Enable Pages**

On GitHub: repo → Settings → Pages → "Build and deployment" → Source:
**GitHub Actions**. That's the only setting; the workflow does the rest.

**3. Watch the first deploy**

The push in step 1 already triggered the workflow (Actions tab). It installs,
runs all 58 tests, builds, and publishes. Green check ≈ 2 minutes.

Note: the temporary `https://<username>.github.io/pace/` URL will look broken
(the app is built for a root path). That's expected — it heals in step 4.

**4. Connect your domain**

At your DNS provider for asmunden.com, add:

```
Type:  CNAME
Name:  pace
Value: <your-username>.github.io
```

(If the DNS is on Cloudflare, set the record to "DNS only" / grey cloud until
the certificate is issued; you can turn the proxy on afterwards.)

Then on GitHub: Settings → Pages → Custom domain → `pace.asmunden.com` → Save.
Wait for the DNS check to pass, then tick **Enforce HTTPS** (the certificate can
take a few minutes to issue).

**5. Verify**

- Open https://pace.asmunden.com — the app loads, /now redirect works.
- Open a day link directly (e.g. paste a /plan/… URL) — the SPA fallback serves it.
- On your phone: open the site, "Add to Home Screen", then enable airplane mode
  and reopen — the app must work fully offline. (The service worker caches on the
  first visit; give it one normal load first.)
- Send yourself a share link — the plan travels in the URL fragment, no server involved.

**6. Updating**

`git push` → automatic test + build + deploy. Users' phones pick up the new
version on the next visit with connectivity (the service worker updates in the
background; a refresh activates it). Logs and plans live in each phone's
localStorage — deploys never touch user data.

## Alternative: Cloudflare Pages (~same effort, faster CDN)

Dashboard → Workers & Pages → Create → Pages → connect the GitHub repo:
build command `npx ng build`, output directory `dist/pace/browser`. The included
`public/_redirects` handles SPA fallback. Custom domain: add `pace.asmunden.com`
in the Pages project (one click if asmunden.com's DNS is already on Cloudflare).

## The Oracle VM (later, with the backend)

When the Spring Boot sync backend exists, a VM becomes the right tool: nginx (or
Caddy for automatic TLS) serves `dist/pace/browser` and reverse-proxies `/api` to
the Java process. The nginx line that matters for the SPA:

```nginx
location / {
  root /var/www/pace;
  try_files $uri /index.html;
}
location /api/ {
  proxy_pass http://127.0.0.1:8080;
}
```

Until then, the static host does everything this app needs, for free.
