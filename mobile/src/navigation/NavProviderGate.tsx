import React, { type ReactNode } from 'react';

/** Navigation SDK fue removido. Este wrapper es un simple pass-through. */
export function isGoogleNavigationNativeAvailable(): boolean {
  return false;
}

type Props = { children: ReactNode };

export function NavProviderGate({ children }: Props): React.JSX.Element {
  return <>{children}</>;
}
