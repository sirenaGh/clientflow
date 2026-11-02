import { test, expect } from "@playwright/test";

test("late anonymous bootstrap cannot replace the session used by failed login", async ({
  page,
  context,
}) => {
  let submitting = false,
    bootRequests = 0,
    loginPosts = 0;
  let releaseBoot!: () => void,
    releaseBody!: () => void,
    lateReady!: () => void;
  const bootGate = new Promise<void>((resolve) => {
    releaseBoot = resolve;
  });
  const bodyGate = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const lateResponse = new Promise<void>((resolve) => {
    lateReady = resolve;
  });
  let lateDone = Promise.resolve();
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/auth/login")
    )
      loginPosts++;
  });
  await page.route("**/api/auth/session", async (route) => {
    if (!submitting && ++bootRequests > 1) {
      let finish!: () => void;
      lateDone = new Promise<void>((resolve) => {
        finish = resolve;
      });
      try {
        // Preserve the original anonymous request's cookies. The real backend
        // creates its session; no API response or database persistence is mocked.
        const headers = {
          ...route.request().headers(),
          cookie: route.request().headers().cookie || "",
        };
        await bootGate;
        const response = await route.fetch({ headers });
        lateReady();
        await bodyGate;
        await route.fulfill({ response });
      } finally {
        finish();
      }
      return;
    }
    const response = await route.fetch();
    if (submitting && bootRequests > 1) {
      // Model a duplicate boot response setting its cookie after the login form
      // refreshes its token but before that form submits its POST.
      releaseBoot();
      await lateResponse;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto("/");
    await page.getByLabel("Email address").fill("avery@clientflow.test");
    await page.getByLabel("Password", { exact: true }).fill("incorrect");
    submitting = true;
    const login = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login"),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await login).status()).toBe(401);
    await expect(page.getByRole("alert")).toContainText("incorrect");
    expect(bootRequests).toBe(1);
    expect(loginPosts).toBe(1);
    const session = await context.request.get("/api/auth/session");
    const { csrf } = await session.json();
    const badOrigin = await context.request.post("/api/auth/login", {
      headers: { Origin: "https://untrusted.example", "x-csrf-token": csrf },
      data: { email: "avery@clientflow.test", password: "incorrect" },
    });
    expect(badOrigin.status()).toBe(403);
  } finally {
    releaseBoot();
    releaseBody();
    await lateDone;
  }
});
