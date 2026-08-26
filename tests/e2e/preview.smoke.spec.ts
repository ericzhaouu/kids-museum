import { expect, test } from "@playwright/test";

test("preview visitor flow covers foyer, room, close look, theme, simple mode, bulk path, and privacy poster", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始参观" })).toBeVisible();
  await expect(page.getByText("家庭私享")).toBeVisible();

  await page.getByRole("button", { name: "开始参观" }).click();
  await page.waitForFunction(() => {
    const gallery = document.querySelector<HTMLElement>(".gallery-viewport");
    return (
      gallery !== null &&
      Math.abs(gallery.scrollLeft - gallery.clientWidth) <= 2
    );
  });
  await expect(page.getByLabel("近看作品：飞过屋顶的鲸鱼")).toBeVisible();

  await page.getByLabel("近看作品：飞过屋顶的鲸鱼").click();
  await expect(page.getByRole("dialog", { name: "飞过屋顶的鲸鱼" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载所选隐私安全海报" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭作品详情" }).click();

  await page.getByRole("button", { name: "打开作品目录" }).click();
  await page.getByRole("button", { name: "白盒展室" }).click();
  await expect(page.getByText("只改变视觉主题或参观方式")).toBeVisible();
  await page.getByRole("button", { name: "进入简洁模式" }).click();
  await expect(page.getByText("目录与静态网格，更适合低性能设备与无障碍浏览")).toBeVisible();

  await page.goto("/studio");
  await page.getByRole("button", { name: "批量录入新作品" }).click();
  await expect(page.getByRole("heading", { name: "批量录入作品" })).toBeVisible();
  await expect(page.getByText("批量选择作品照片")).toBeVisible();
});
