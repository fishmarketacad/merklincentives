# Setting Up Vercel Protection Bypass for Automation

## Steps

1. **Go to Vercel Dashboard**
   - Navigate to: Your Project → Settings → Deployment Protection

2. **Find "Protection Bypass for Automation" Section**
   - Scroll down to the third section

3. **Add a Bypass Secret**
   - In the "Secret" input field, enter a secure random string
   - **Must be exactly 32 characters** (Vercel requirement)
   - Options:
     - Generate a new 32-char secret: `openssl rand -hex 16` (produces 32 hex characters)
     - Use first 32 characters of your CRON_SECRET: `051b47e0f32ecacb0844f85e9978236`
     - Generate using: `openssl rand -base64 24 | head -c 32` (32 base64 characters)

4. **Click "+ Add"**
   - This will save the bypass secret

5. **Automatic Configuration**
   - Vercel automatically sets `VERCEL_AUTOMATION_BYPASS_SECRET` environment variable
   - The cron endpoint will automatically use this token for internal API calls
   - No additional code changes needed!

## How It Works

- **Regular users**: Still see the protection page (secure)
- **Automation (cron)**: Uses the bypass token to access internal APIs
- **GitHub Actions**: Will work automatically once bypass is configured

## Testing

After setting up the bypass:

1. The bypass token is automatically available as `VERCEL_AUTOMATION_BYPASS_SECRET`
2. The cron endpoint will use it automatically for internal API calls
3. Test with:
   ```bash
   curl -X GET \
     -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://merklincentives.vercel.app/api/cron/refresh-dashboard
   ```

## Security Notes

- The bypass token is only used for internal API calls within the same deployment
- Regular users still see protection
- The token is stored securely in Vercel environment variables
- Never commit the bypass token to git (it's automatically managed by Vercel)
