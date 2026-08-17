import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Darwinbox HR Assistant" },
      {
        name: "description",
        content:
          "Sign in to the Darwinbox HR Assistant to check leave balances, attendance and work-from-home requests.",
      },
      { property: "og:title", content: "Sign in — Darwinbox HR Assistant" },
      {
        property: "og:description",
        content: "Employee sign-in for the Darwinbox HR Assistant.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search['next'] === "string" ? search['next'] : "",
  }),
  component: AuthPage,
});

/** Only same-origin relative paths are accepted as a post-sign-in destination. */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function AuthPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const destination = safeNext(next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function goToDestination() {
    if (destination.startsWith("/.lovable/")) {
      window.location.href = destination;
      return;
    }
    void navigate({ to: destination });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${destination}`,
        },
      });
      setBusy(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      setMessage("Check your email to confirm your account, then come back and sign in.");
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    goToDestination();
  }

  async function google() {
    setBusy(true);
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}${destination}`,
    });
    if (result.error) {
      setBusy(false);
      setError(result.error.message ?? "Google sign-in failed.");
      return;
    }
    if (result.redirected) return;
    goToDestination();
  }

  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">
        {mode === "signin" ? "Sign in" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use your work account to reach your leave, attendance and work-from-home records.
      </p>

      <form className="mt-6 space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <Button variant="outline" className="mt-3 w-full" disabled={busy} onClick={google}>
        Continue with Google
      </Button>

      <button
        type="button"
        className="mt-6 text-sm text-muted-foreground underline"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setMessage(null);
        }}
      >
        {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
