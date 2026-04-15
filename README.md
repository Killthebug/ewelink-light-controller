# ewelink-light-controller
Local webapp for controlling eWeLink smart lights on your home network


## How It Works

This app uses the [eWeLink API npm package](https://www.npmjs.com/package/ewelink-api) which bundles the official eWeLink app credentials. **You do NOT need a developer account or API key.** Just your regular eWeLink email and password.

## Troubleshooting

### "No devices detected"
1. Make sure you're using the **same email and password** as the eWeLink mobile app
2. Verify your eWeLink account email is activated (check inbox for verification)
3. Try logging into the eWeLink app first to confirm credentials work
4. If you set a region manually, try removing it — the app auto-detects
5. Visit `http://localhost:3456/api/debug` for detailed diagnostics

### Common error codes
| Code | Meaning | Fix |
|------|---------|-----|
| 401 | Wrong email or password | Double-check your credentials |
| 402 | Email not activated | Verify your eWeLink account email |
| 406 | Authentication failed | Use your app login, not developer API keys |
| 503 | Service unavailable | Try again in a minute |

### Still stuck?
Hit the **"Run Diagnostics"** button on the error page, or visit `/api/debug` directly for a detailed breakdown of what's failing.