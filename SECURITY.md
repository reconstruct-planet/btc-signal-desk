# Security Notes

BTC Signal Desk is a static GitHub Pages site. It does not store exchange keys,
wallet keys, passwords, or private user data in the browser.

## Current protections

- Content Security Policy restricts scripts, network calls, frames, forms, and embedded objects.
- Framing is blocked to reduce clickjacking risk.
- Browser permissions for camera, microphone, geolocation, payments, and USB are disabled.
- The local preview server sends security headers and serves only files inside this project.
- The local preview server allows only `GET` and `HEAD` requests.
- Static asset URLs include a cache-busting version so security changes are picked up quickly.

## Risks that code alone cannot remove

- If the GitHub account or repository is compromised, an attacker can change the deployed site.
- If a third-party CDN or external market API is compromised, the app may receive bad external code or data.
- This site is an analysis dashboard, not guaranteed financial advice or a protected trading system.

## Operational checklist

- Enable two-factor authentication on the GitHub account.
- Keep repository collaborators minimal.
- Protect the `main` branch before inviting collaborators.
- Review every deployed change before pushing to GitHub Pages.
- Never commit API keys, wallet keys, private keys, passwords, or seed phrases.
