export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackground } = await import("./server/background");
    startBackground();
  }
}
