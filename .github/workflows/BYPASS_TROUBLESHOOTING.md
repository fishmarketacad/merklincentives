# Troubleshooting Vercel Bypass Secret

## Important: Build Logs vs Runtime Logs

**Build logs don't show environment variables** - they're only available at runtime in serverless functions.

To check if the bypass secret is available:
1. Go to **Vercel Dashboard → Your Project → Deployments → Latest → Functions → `/api/cron/refresh-dashboard`**
2. Look at the **Runtime Logs** (not build logs)
3. You should see: `[Cron] Using Vercel automation bypass token (length: 32)`

## If VERCEL_AUTOMATION_BYPASS_SECRET Still Doesn't Work

The code now supports a fallback environment variable `BYPASS_SECRET`:

1. **Go to Vercel Dashboard → Settings → Environment Variables**
2. **Add New Variable:**
   - Name: `BYPASS_SECRET`
   - Value: Your 32-character bypass secret (same as you added in Protection Bypass)
   - Environment: All (Production, Preview, Development)
3. **Save** - Vercel will redeploy

## Verify It's Working

After redeploying, check the **Runtime Logs** (not build logs) when you call the endpoint:

```bash
curl --max-time 30 -X GET \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://merklincentives.vercel.app/api/cron/refresh-dashboard
```

In the runtime logs, you should see:
- ✅ `[Cron] Using Vercel automation bypass token (length: 32)` - Success!
- ❌ `[Cron] Warning: No bypass token found` - Still not set

## Why Build Logs Don't Show Environment Variables

- Build logs show the build process (compilation, static generation)
- Environment variables are only injected at runtime in serverless functions
- This is a security feature - secrets shouldn't appear in build logs

## Next Steps

1. Check **Runtime Logs** (not build logs) after calling the endpoint
2. If still not working, add `BYPASS_SECRET` as a fallback
3. The code will automatically use whichever is available
