import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { InviteView } from "./InviteView";

/** The invite token comes from the URL, which is only known per request, so the view renders inside Suspense. */
export default function InvitePage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <InviteView />
    </Suspense>
  );
}
