const lock = "edgey-checkout-attempt";

export function withCheckoutAttemptLock<T>(update: () => T): Promise<T> {
  return navigator.locks ? navigator.locks.request(lock, update) : Promise.resolve(update());
}
