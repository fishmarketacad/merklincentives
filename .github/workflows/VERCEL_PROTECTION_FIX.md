# Fixing Vercel Deployment Protection Issue

## Problem
The cron endpoint is being blocked by Vercel's deployment protection when trying to make internal API calls.

## Solutions

### Option 1: Disable Protection for Preview Deployments (Recommended)
1. Go to Vercel Dashboard → Your Project → Settings → Deployment Protection
2. Configure protection to only apply to Production deployments
3. Preview deployments (including GitHub Actions triggers) will bypass protection

### Option 2: Use Bypass Token
1. Go to Vercel Dashboard → Your Project → Settings → Deployment Protection
2. Generate a bypass token
3. Add it to the cron endpoint URL: `?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=TOKEN`
4. Update the GitHub Actions workflow to include the bypass token

### Option 3: Whitelist API Routes
1. Go to Vercel Dashboard → Your Project → Settings → Deployment Protection
2. Configure protection to exclude `/api/*` paths
3. This allows API routes to be accessed without protection

### Option 4: Use Vercel Internal Network (If Available)
If your Vercel plan supports it, use internal networking to bypass protection.

## Recommended Approach
**Option 1** is the simplest - disable protection for preview deployments since:
- Production deployments can still be protected
- Preview deployments (used by GitHub Actions) won't be blocked
- No code changes needed

## Testing
After applying the fix, test with:
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://merklincentives.vercel.app/api/cron/refresh-dashboard
```

You should see a JSON response with `success: true` instead of the authentication page.
