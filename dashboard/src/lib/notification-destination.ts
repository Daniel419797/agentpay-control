export function notificationDestinationDisplay(type: string, destination: string) {
  if (type === "EMAIL") return destination;
  try {
    const url = new URL(destination);
    return `${url.origin}/••••`;
  } catch {
    return "Configured endpoint";
  }
}
