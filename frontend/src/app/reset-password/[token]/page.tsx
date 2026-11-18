import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ResetView } from "./ResetView";

/** The reset token comes from the URL (known only per request), so the view renders inside Suspense. */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <ResetView />
    </Suspense>
  );
}
