import { expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:4406";

test("home renders, navigation loads data through the route unit", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByText("Pick a page")).toBeVisible();

  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(`${BASE}/users`);
  // The fake API sleeps 400ms: the pending state must be visible first.
  await expect(page.getByText("Loading…")).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toBeVisible();
});

test("params decode: user page loads from a typed :id", async ({ page }) => {
  await page.goto(`${BASE}/users`);
  await page.getByText("Grace Hopper").click();
  await expect(page).toHaveURL(`${BASE}/users/2?page=1`);
  await expect(page.getByText("Built the first compiler.")).toBeVisible();
});

test("search pagination: Next page bumps ?page= and re-renders", async ({ page }) => {
  await page.goto(`${BASE}/users/1?page=1`);
  await expect(page.getByText("Wrote the first published algorithm.")).toBeVisible();
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(`${BASE}/users/1?page=2`);
  await expect(page.getByText("page = 2")).toBeVisible();
});

test("OBJECT query param: filter travels as JSON and deep-links", async ({ page }) => {
  await page.goto(`${BASE}/users`);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();

  await page.getByTestId("filter-Professor").click();
  await expect(page).toHaveURL(
    `${BASE}/users?filter=${encodeURIComponent('{"role":"Professor"}')}`,
  );
  await expect(page.getByText("Barbara Liskov")).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).not.toBeVisible();

  // Deep link with the JSON object straight in the URL.
  await page.goto(`${BASE}/users?filter=${encodeURIComponent('{"role":"Analyst"}')}`);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Barbara Liskov")).not.toBeVisible();

  await page.getByTestId("filter-all").click();
  await expect(page).toHaveURL(`${BASE}/users`);
  await expect(page.getByText("Barbara Liskov")).toBeVisible();
});

test("deep link to a detail page decodes params and search together", async ({ page }) => {
  await page.goto(`${BASE}/users/3?page=7`);
  await expect(page.getByText("Substitution principle, CLU, Argus.")).toBeVisible();
  await expect(page.getByText("page = 7")).toBeVisible();
});

test("browser back/forward drive the router", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(`${BASE}/users`);
  await page.getByText("Ada Lovelace").click();
  await expect(page).toHaveURL(`${BASE}/users/1?page=1`);

  await page.goBack();
  await expect(page).toHaveURL(`${BASE}/users`);
  await expect(page.getByText("Grace Hopper")).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`${BASE}/users/1?page=1`);
  await expect(page.getByText("Wrote the first published algorithm.")).toBeVisible();
});

test("unknown URL renders the notFound boundary", async ({ page }) => {
  await page.goto(`${BASE}/nope/nothing`);
  await expect(page.getByText("404")).toBeVisible();
});

test("links are real anchors with hrefs", async ({ page }) => {
  await page.goto(`${BASE}/users`);
  const href = await page
    .getByRole("link", { name: "Ada Lovelace Analyst" })
    .getAttribute("href");
  expect(href).toBe("/users/1?page=1");
});
