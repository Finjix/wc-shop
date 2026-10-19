
/** Share concurrent downloads, but never cache a failed download. */
export function createPackageLoader(load: () => Promise<any>) {
  let pending: Promise<any> | undefined;
  return () => {
    if (!pending) pending = Promise.resolve().then(load).catch(error => { pending = undefined; throw error; });
    return pending;
  };
}
