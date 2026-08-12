import { timingSafeEqual } from "node:crypto";

export function bearerSecretMatches(
  primary: string | undefined,
  fallback: string | undefined,
  authorization: string | undefined,
) {
  const expected = primary ?? fallback;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
