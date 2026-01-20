# How to Check Vercel Function Logs

## Step-by-Step:

1. **Go to Deployments Page**
   - You're already here: Vercel Dashboard → Your Project → Deployments

2. **Click on a Specific Deployment**
   - Click on any deployment row (e.g., the most recent one with "83b34ba")
   - This opens the deployment detail page

3. **Find the Functions Tab**
   - On the deployment detail page, you'll see tabs like:
     - "Overview"
     - "Build Logs" 
     - **"Functions"** ← This is what you need!
     - "Source"
     - etc.

4. **Click on Functions Tab**
   - You'll see a list of all API routes
   - Find `/api/cron/refresh-dashboard`
   - Click on it

5. **View Runtime Logs**
   - You'll see the runtime logs for that function
   - These logs appear when the function is called (not during build)

## Alternative: Check Logs After Calling the Endpoint

1. **Call the endpoint:**
   ```bash
   curl --max-time 30 -X GET \
     -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://merklincentives.vercel.app/api/cron/refresh-dashboard
   ```

2. **Then immediately check:**
   - Go to Deployments → Latest Deployment → Functions → `/api/cron/refresh-dashboard`
   - You should see the logs appear in real-time

## What to Look For:

In the runtime logs, you should see:
- `[Cron] Starting dashboard refresh...`
- `[Cron] VERCEL_AUTOMATION_BYPASS_SECRET available: true/false`
- `[Cron] Using Vercel automation bypass token (length: 32)` ← Success!
- Or warnings if the bypass token isn't set

## Quick Test:

1. Run your curl command
2. Immediately go to: Deployments → [Latest] → Functions → `/api/cron/refresh-dashboard`
3. Check the logs that just appeared
