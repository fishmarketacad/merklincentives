# Manual Setup for VERCEL_AUTOMATION_BYPASS_SECRET

If `VERCEL_AUTOMATION_BYPASS_SECRET` is not automatically set by Vercel, you need to add it manually.

## Steps:

1. **Go to Vercel Dashboard**
   - Navigate to: Your Project → Settings → Environment Variables

2. **Add New Environment Variable**
   - Click "Add New"
   - **Name**: `VERCEL_AUTOMATION_BYPASS_SECRET`
   - **Value**: The same 32-character secret you added in "Protection Bypass for Automation"
   - **Environment**: Select all (Production, Preview, Development)

3. **Save**
   - Click "Save"
   - Vercel will automatically redeploy

## Alternative: Use the Bypass Secret Directly

If you prefer not to add it as an environment variable, you can also use the bypass secret directly in the code by reading it from the protection settings. However, the environment variable approach is cleaner.

## Verify It's Set

After adding the environment variable and redeploying:
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Search for `VERCEL_AUTOMATION_BYPASS_SECRET`
3. It should show up with your 32-character value

## Test

After redeploying, test with:
```bash
curl --max-time 30 -X GET \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://merklincentives.vercel.app/api/cron/refresh-dashboard
```

Check the Vercel function logs to see:
- `[Cron] VERCEL_AUTOMATION_BYPASS_SECRET available: true` ✅
