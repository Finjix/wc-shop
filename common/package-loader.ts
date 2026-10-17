declare const require: { async(path: string): Promise<any> };

/** Share concurrent downloads, but never cache a failed download. */
export function createPackageLoader(load: () => Promise<any>) {
  let pending: Promise<any> | undefined;
  return () => {
    if (!pending) pending = Promise.resolve().then(load).catch(error => { pending = undefined; throw error; });
    return pending;
  };
}

export const loadFrontend = createPackageLoader(() => require.async('../packages/frontend/ready'));
