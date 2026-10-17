import { testEnv } from "./test-env.mjs";

export function reviewEnv() {
  const env = testEnv();
  const url = new URL(process.env.REVIEW_DATABASE_URL || env.DATABASE_URL);
  if (!process.env.REVIEW_DATABASE_URL)
    url.pathname = "/clientflow_review_test";
  if (!/^\/[a-zA-Z0-9_]+_review_test$/.test(url.pathname)) {
    throw new Error(
      "Review captures require a separate database ending in _review_test",
    );
  }
  if (
    [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].some(
      (value) => value && new URL(value).pathname === url.pathname,
    )
  ) {
    throw new Error(
      "The review database must differ from development and integration databases",
    );
  }
  return { ...env, DATABASE_URL: url.toString() };
}
