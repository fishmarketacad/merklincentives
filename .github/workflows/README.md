# GitHub Actions Workflow Setup

## Refresh Dashboard Cache Workflow

This workflow automatically refreshes the dashboard cache daily at midnight UTC by calling the `/api/cron/refresh-dashboard` endpoint.

## Required GitHub Secrets

You need to set up the following secrets in your GitHub repository:

1. **VERCEL_URL**: Your Vercel deployment URL
   - Go to: Repository Settings → Secrets and variables → Actions → New repository secret
   - Name: `VERCEL_URL`
   - Value: Your Vercel app URL (e.g., `https://merklincentives.vercel.app`)

2. **CRON_SECRET**: Secret token for authenticating cron requests
   - Go to: Repository Settings → Secrets and variables → Actions → New repository secret
   - Name: `CRON_SECRET`
   - Value: A secure random string (e.g., generate with `openssl rand -hex 32`)
   - **Important**: Also set this same value in your Vercel environment variables as `CRON_SECRET`

## Setting Up Secrets

### Step 1: Generate CRON_SECRET
```bash
openssl rand -hex 32
```

### Step 2: Add to GitHub Secrets
1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add `VERCEL_URL` with your Vercel deployment URL
5. Add `CRON_SECRET` with the generated secret

### Step 3: Add to Vercel Environment Variables
1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add `CRON_SECRET` with the same value as GitHub secret

## Manual Trigger

You can manually trigger the workflow from the GitHub Actions tab:
1. Go to **Actions** tab in your repository
2. Select **Refresh Dashboard Cache** workflow
3. Click **Run workflow** → **Run workflow**

## Schedule

The workflow runs automatically:
- **Daily at midnight UTC** (00:00 UTC)
- Can be manually triggered anytime via GitHub Actions UI

## Troubleshooting

- **401 Unauthorized**: Check that `CRON_SECRET` matches in both GitHub and Vercel
- **Connection refused**: Verify `VERCEL_URL` is correct and the app is deployed
- **Workflow not running**: Check that GitHub Actions is enabled for your repository
