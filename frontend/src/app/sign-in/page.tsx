import { Suspense } from "react";
import { AuthPageView } from "@/components/qlix/auth-page-view";

interface SignInPageProps {
  searchParams: Promise<{ mode?: string; workspace?: string; invite?: string }>;
}

function AuthFallback() {
  return <div className="min-h-dvh bg-[#f2efe8]" aria-hidden />;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const initialMode = params.mode === "sign-up" ? "sign-up" : "sign-in";
  const defaultWorkspaceType =
    params.workspace === "organization" || params.workspace === "individual"
      ? params.workspace
      : "individual";
  const inviteKey = params.invite ? "i" : "";

  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthPageView
        key={`${initialMode}-${defaultWorkspaceType}-${inviteKey}`}
        initialMode={initialMode}
        defaultWorkspaceType={defaultWorkspaceType}
      />
    </Suspense>
  );
}
