# Stabilize recurring Lovable Cloud environment bindings

## Confirmed current state
- The hosted backend is healthy and available.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and both browser-safe `VITE_` bindings are present in the current sandbox.
- The active Assistant route currently renders without the missing-variable error.
- The error text originates from the generated Lovable Cloud client/auth integration when a preview process starts without its injected bindings.

## Plan of action
1. **Refresh the managed bindings**
   - Rebind the project’s Lovable Cloud secrets so the preview receives the canonical runtime and browser-safe values.

2. **Restart only the preview process**
   - Restart Vite once after rebinding so it reads the refreshed environment at process startup.
   - Do not modify generated integration files, commit keys, or add fallback credentials to source control.

3. **Verify the paths that exercise both binding types**
   - Load the current Assistant session to test the browser-safe client.
   - Call the session API to test server runtime access.
   - Confirm page rendering, HTTP success, and absence of fresh missing-variable logs.

4. **Capture recurrence evidence**
   - If a newly created preview sandbox loses the bindings again, record the timestamp and fresh server-log evidence.
   - Escalate it as a Lovable preview environment-injection issue; repeated rebinding is recovery, not a permanent application-code fix.

## Scope
No database migration or application behavior change is needed. The app should continue failing closed rather than embedding backend credentials as a workaround.