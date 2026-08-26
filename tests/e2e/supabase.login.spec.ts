import { expect, test } from "@playwright/test";

type MailpitMessage = {
  ID: string;
  Subject: string;
};

type MailpitList = {
  messages: MailpitMessage[];
};

test("@supabase curator can complete the magic-link login flow", async ({
  page,
  request,
}) => {
  const before = await request.get("http://127.0.0.1:54324/api/v1/messages");
  expect(before.ok()).toBe(true);
  const existingIds = new Set(
    ((await before.json()) as MailpitList).messages.map((message) => message.ID),
  );

  await page.goto("/login");
  await page.getByLabel("邮箱").fill("curator@kids-museum.local");
  await page.getByRole("button", { name: "发送免密码登录链接" }).click();
  await expect(page.getByText("登录链接已发送，请查看邮箱。")).toBeVisible();
  const verifierCookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("code-verifier"),
  );
  expect(
    verifierCookies.map((cookie) => cookie.name),
    "PKCE verifier cookie must be present after requesting a magic link",
  ).not.toHaveLength(0);

  let messageId = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(
          "http://127.0.0.1:54324/api/v1/messages",
        );
        const list = (await response.json()) as MailpitList;
        const message = list.messages.find(
          (item) =>
            !existingIds.has(item.ID) && item.Subject === "Your sign-in link",
        );
        messageId = message?.ID ?? "";
        return Boolean(messageId);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const detailResponse = await request.get(
    `http://127.0.0.1:54324/api/v1/message/${messageId}`,
  );
  expect(detailResponse.ok()).toBe(true);
  const detail = (await detailResponse.json()) as { HTML: string };
  const href = detail.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll(
    "&amp;",
    "&",
  );
  expect(href).toBeTruthy();

  await page.goto(href!);
  await expect(page).toHaveURL(/\/studio$/);
  await expect(
    page.getByRole("heading", {
      name: /早上好，馆长|先创建一座新的博物馆/,
    }),
  ).toBeVisible({ timeout: 30_000 });
});
