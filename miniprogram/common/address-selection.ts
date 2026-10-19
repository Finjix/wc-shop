type SelectedAddress = Record<string, unknown>;

/** App 持有唯一实例，订单和地址分包共享同一组待完成的选择请求。 */
export function createAddressSelection() {
  let pending: Array<{
    resolve: (address: SelectedAddress) => void;
    reject: (error: Error) => void;
  }> = [];

  return {
    getAddressPromise() {
      return new Promise<SelectedAddress>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    resolveAddress(address: SelectedAddress) {
      const requests = pending;
      pending = [];
      requests.forEach(({ resolve }) => resolve(address));
    },
    rejectAddress() {
      const requests = pending;
      pending = [];
      requests.forEach(({ reject }) => reject(new Error('cancel')));
    },
  };
}
