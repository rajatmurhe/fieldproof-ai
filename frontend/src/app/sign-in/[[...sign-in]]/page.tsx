import { SignIn } from "@clerk/nextjs";
import AuthShell from "@/components/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn fallbackRedirectUrl="/" />
    </AuthShell>
  );
}
