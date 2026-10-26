"use client";

import {
  OrganizationSwitcher,
  UserButton,
} from "@clerk/nextjs";

export default function ClerkControls() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <OrganizationSwitcher
        hidePersonal
        afterSelectOrganizationUrl="/"
        afterCreateOrganizationUrl="/"
        // Below xl only the organisation's avatar shows, so the header fits beside the nav. The trailing !
        // is needed because Clerk's own styles sit outside Tailwind's layers and would win.
        appearance={{
          elements: {
            organizationPreviewTextContainer: "max-xl:hidden!",
            organizationSwitcherTrigger: "max-sm:px-1!",
          },
        }}
      />
      <UserButton />
    </div>
  );
}
