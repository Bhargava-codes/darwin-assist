# Stop the recurring backend environment error

## What the checks show

- The Lovable Cloud backend is healthy and active.
- The current sandbox now contains all required server-side and browser-side environment values.
- The generated backend client and authentication middleware read those managed values at runtime; the app does not persist them itself.
- The current dev-server log does not contain the reported missing-variable error.

This points to an intermittent **sandbox binding/startup issue**, not missing database configuration or an application data problem. Rebinding repairs the current sandbox, but a new or restarted sandbox can reproduce the error if it starts before the managed Cloud binding is injected or retains a stale binding.

## Plan

1. **Refresh the managed Cloud binding**
   - Rebind the canonical backend URL and keys to the current project environment.
   - Do not hardcode keys or add a committed `.env` file.

2. **Restart only the preview process**
   - Restart Vite once after rebinding so it reads the refreshed values at process startup.
   - Do not restart the database because it is healthy and is not the source of this error.

3. **Validate browser and server execution**
   - Load the assistant to verify the browser-side values.
   - Exercise an authenticated request to verify the server-side values.
   - Check the browser console and server log for the exact missing-variable message.

4. **Escalate if a fresh sandbox loses the binding again**
   - If the error returns after the verified rebind and restart, treat it as a recurring Lovable Cloud environment-injection fault rather than patching generated client code.
   - Capture the recurrence timing and report it to Lovable support, because application code cannot make managed runtime bindings persist across sandbox provisioning.

## Expected outcome

The preview starts with its managed Cloud configuration and both browser and server requests work. If it recurs after a fresh sandbox is provisioned, the evidence isolates the platform binding lifecycle for support.