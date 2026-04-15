# ewelink-light-controller

Local webapp for controlling eWeLink smart lights on your home network.

## Important: OAuth2 Required (v2.0)

As of late 2024, eWeLink restricted direct API login to enterprise accounts ($2k/yr). This app now uses the **OAuth2 flow** which requires your own developer credentials.

## Setup

### 1. Get Developer Credentials

1. Go to [dev.ewelink.cc](https://dev.ewelink.cc) and register/log in
2. Create a new application
3. Note your **APP_ID** and **APP_SECRET**
4. Add a **redirect URL** — e.g. `https://127.0.0.1:8888` (it will not actually be used, but must be set)

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
- `EWELINK_APP_ID` — from dev.ewelink.cc
- `EWELINK_APP_SECRET` — from dev.ewelink.cc
- `EWELINK_EMAIL` — your eWeLink account email
- `EWELINK_PASSWORD` — your eWeLink account password

### 3. Run

```bash
npm install
npm start
```

Open [http://localhost:3456](http://localhost:3456)

## Requirements

- **Node.js 18+** (uses built-in `fetch`)

## Troubleshooting

Visit `http://localhost:3456/api/debug` for detailed diagnostics.

### Common Issues

| Error | Fix |
|-------|-----|
| `appid is unauthorized` | Check your APP_ID at dev.ewelink.cc |
| `Wrong credentials` | Use the same email/password as the eWeLink app |
| `Email not activated` | Verify your eWeLink account email |
| `Network error` | Check your internet connection |
| `WebSocket timeout` | Device may be offline or unreachable |

### How it works

1. **OAuth2 login** — exchanges your email/password for an access token via eWeLink's OAuth2 flow
2. **Device list** — fetches all devices via the REST API
3. **Device control** — sends commands via WebSocket (same as the eWeLink app)
4. **Region auto-detection** — no need to manually set your region
