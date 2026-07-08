import { expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:4407";

test("middleware blocks navigation BEFORE commit: /admin never enters history", async ({
  page,
}) => {
  const urls: Array<string> = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(new URL(frame.url()).pathname);
  });

  await page.goto(`${BASE}/`);
  await page.getByRole("link", { name: "Admin" }).click();

  // Redirected by the guard: we are on /login...
  await expect(page).toHaveURL(`${BASE}/login`);
  // ...and /admin never appeared, not even for a frame.
  expect(urls).not.toContain("/admin");

  // Back does not resurrect the blocked URL either.
  await page.goBack();
  expect(new URL(page.url()).pathname).not.toBe("/admin");
});

test("middleware provides typed data after login", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByRole("textbox").fill("trinity");
  await page.getByRole("button", { name: "Log in" }).click();

  // The guard passed and PROVIDED the user: the admin page renders it.
  await expect(page).toHaveURL(`${BASE}/admin`);
  await expect(page.getByText("Welcome, trinity")).toBeVisible();
});

test("direct deep link to a guarded URL redirects on initial load", async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  // commitLocation follows the guard's redirect instead of erroring.
  await expect(page).toHaveURL(`${BASE}/login`);
});

test("logout re-arms the guard", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByRole("textbox").fill("neo");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(`${BASE}/admin`);

  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(`${BASE}/login`);
});
