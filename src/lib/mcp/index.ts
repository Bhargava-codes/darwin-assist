import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getMyHrProfile from "./tools/get-my-hr-profile";
import getLeaveBalances from "./tools/get-leave-balances";
import listLeaveRequests from "./tools/list-leave-requests";
import listWfhRequests from "./tools/list-wfh-requests";
import searchHrPolicy from "./tools/search-hr-policy";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "hr-assistant",
  title: "HR Assistant",
  version: "0.1.0",
  instructions:
    "Read-only HR tools for the signed-in employee. Use get_my_hr_profile for employment details, get_leave_balances for leave entitlement and availability, list_leave_requests and list_wfh_requests for request history, and search_hr_policy to ground answers in the company HR policy manual. Always cite the returned clause ids when stating a policy rule, and never state a leave figure that did not come from get_leave_balances.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMyHrProfile, getLeaveBalances, listLeaveRequests, listWfhRequests, searchHrPolicy],
});
