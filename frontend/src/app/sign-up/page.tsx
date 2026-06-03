import { redirect } from "next/navigation";

interface SignUpPageProps {
  searchParams: Promise<{ workspace?: string }>;
}

/** Canonical auth UI lives on `/sign-in` with `?mode=sign-up` (toggle + shared layout). */
export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const workspace =
    params.workspace === "organization" || params.workspace === "individual"
      ? params.workspace
      : "individual";
  redirect(`/sign-in?mode=sign-up&workspace=${workspace}`);
}
