export function requestDocumentPointerLockHandoff(): boolean {
  if (typeof document.documentElement.requestPointerLock !== "function") return false;
  try {
    void Promise.resolve(document.documentElement.requestPointerLock()).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
