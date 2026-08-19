# Fix missing Supabase environment variables

## Problem
The app fails at runtime with:
`Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Connect Supabase in Lovable Cloud.`

This means the dev sandbox no longer has the Supabase URL / publishable key injected, so the auto-generated client cannot initialize.

## Plan

1. **Rebind Supabase secrets**
   - Use the `supabase--rebind_secrets` tool to re-derive and re-inject `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into the sandbox environment.
   - This is idempotent and safe to retry.

2. **Restart the dev server if needed**
   - After rebind, check whether the dev server picks up the new env vars.
   - If the preview still shows the same error, kill the Vite process so the supervisor respawns it with fresh env vars.

3. **Validate the fix**
   - Open the preview root route and confirm the app loads without the Supabase error.
   - Check the browser console for any remaining client-side errors.

## Expected outcome
The app initializes the Supabase client successfully and the preview loads normally.
