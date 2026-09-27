"use client";

import {
  OrganizationSwitcher,
  UserButton,
} from "@clerk/nextjs";

export default function ClerkControls() {
  return (
    <div className="flex items-center gap-3">
      <OrganizationSwitcher
        hidePersonal
        afterSelectOrganizationUrl="/"
        afterCreateOrganizationUrl="/"
      />
      <UserButton />
    </div>
  );
}
