# Testing the GitHub Actions Workflow

## How to Test if It's Working

### Method 1: Manual Trigger (Recommended for Testing)

1. **Go to GitHub Actions Tab**
   - Navigate to: `https://github.com/fishmarketacad/merklincentives/actions`
   - You should see "Refresh Dashboard Cache" workflow in the list

2. **Manually Trigger the Workflow**
   - Click on "Refresh Dashboard Cache" workflow
   - Click the "Run workflow" dropdown button (top right)
   - Select "Run workflow" (leave branch as `main`)
   - Click the green "Run workflow" button

3. **Monitor the Execution**
   - The workflow will appear in the runs list
   - Click on the run to see detailed logs
   - Look for:
     - ✅ "Calling refresh endpoint at: [your-url]/api/cron/refresh-dashboard"
     - ✅ "Response code: 200"
     - ✅ "Dashboard refresh completed successfully!"
     - Response body showing: `success: true`, `date`, `poolsCount`, etc.

### Method 2: Check Vercel Logs

After triggering the workflow, check your Vercel deployment logs:

1. Go to Vercel Dashboard → Your Project → Deployments
2. Click on the latest deployment
3. Go to "Functions" tab → `/api/cron/refresh-dashboard`
4. Look for logs showing:
   - `[Cron] Starting dashboard refresh...`
   - `[Cron] Fetching data for: { startDate, endDate }`
   - `[Cron] MON price: [price]`
   - `[Cron] Dashboard refresh complete in [X] ms`

### Method 3: Verify Cache Was Updated

1. Visit your dashboard homepage
2. Check if the default data loads (yesterday's date, all protocols selected)
3. The data should be pre-loaded from the cache

## Expected Success Indicators

✅ **Workflow succeeds if you see:**
- HTTP 200 response code
- Response body with `success: true`
- Date matches yesterday (UTC)
- Pools count > 0
- AI analysis included: true/false

❌ **Common Issues:**

1. **401 Unauthorized**
   - Check that `CRON_SECRET` matches in both GitHub and Vercel
   - Verify the secret value is exactly the same (no extra spaces)

2. **Connection Refused / Timeout**
   - Verify `VERCEL_URL` is correct in GitHub secrets
   - Make sure your Vercel app is deployed and accessible
   - Check if the URL has trailing slash (workflow removes it automatically)

3. **Workflow Not Running**
   - Verify GitHub Actions is enabled: Settings → Actions → General
   - Check that workflow file is in `.github/workflows/` directory
   - Ensure you're on the `main` branch

## Testing Checklist

- [ ] Workflow appears in GitHub Actions tab
- [ ] Manual trigger works
- [ ] Response code is 200
- [ ] Response shows `success: true`
- [ ] Vercel logs show refresh activity
- [ ] Dashboard cache is updated (check dashboard-default endpoint)

## Next Scheduled Run

The workflow will automatically run:
- **Daily at midnight UTC** (00:00 UTC)
- You can see upcoming runs in the GitHub Actions tab under "Scheduled workflows"

## Debugging Tips

If something fails:

1. **Check GitHub Actions logs** - Full error messages are shown there
2. **Check Vercel function logs** - See what the endpoint received
3. **Test endpoint directly** - Use curl or Postman to test the endpoint:
   ```bash
   curl -X GET \
     -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://your-app.vercel.app/api/cron/refresh-dashboard
   ```
4. **Verify secrets** - Double-check both secrets are set correctly
